import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Synchronisation optionnelle entre appareils via une table Supabase partagée
 * (« sync_queue »). Sert de boîte aux lettres : un appareil dépose une dictée ou
 * une photo en attente, un autre (typiquement l'ordinateur, avec le pont Claude
 * Code) la traite et l'enregistre dans SON journal — d'où elle remonte aux autres
 * appareils par la synchro d'état (cf. profileSync.ts), pas par cette file.
 * Sans configuration (.env.local absent), la synchro est simplement désactivée.
 *
 * Depuis le passage aux profils authentifiés (cf. supabase/migrations/), `sync_queue` est
 * cloisonnée par `profile_id` et les policies RLS exigent une session Supabase Auth : un compte
 * par profil, dont supabase-js porte et rafraîchit le jeton tout seul (rien à gérer ici).
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Client unique. La session (connexion à un profil) est persistée par supabase-js dans le
 * localStorage et rafraîchie automatiquement : les requêtes ci-dessous portent donc le bon jeton
 * sans que ce module ait à s'en occuper.
 */
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export function isSyncConfigured(): boolean {
  return supabase !== null;
}

/**
 * Champs communs d'horodatage joints par l'appareil ÉMETTEUR au moment où il
 * dépose sur Supabase : `date` = son jour LOCAL (déjà résolu, jamais `todayStr()`
 * différé), `clientTime` = son heure locale en epoch ms. On les propage jusqu'à
 * l'entrée finale pour que l'heure/le jour affichés soient ceux de la SAISIE,
 * pas ceux du traitement différé par le pont Claude Code (potentiellement le
 * lendemain, ou sur un autre fuseau).
 */
interface StampedPayload {
  date?: string;
  /** Heure locale de l'émetteur à l'envoi (epoch ms) → `createdAt` de l'entrée. */
  clientTime?: number;
}

export interface TranscriptPayload extends StampedPayload {
  transcript: string;
}

export interface ImagePayload extends StampedPayload {
  /** Image réduite, en base64 nu (sans préfixe data:…). */
  imageBase64: string;
  mediaType: string;
  /** Message d'erreur si l'extraction a échoué (cf. markImageProcessed) — sinon absent. */
  error?: string;
}

/**
 * Kinds déposés dans la file : uniquement des ENTRÉES en attente de traitement.
 *
 * Les kinds « résultat » (`entry`, `sun-entry`, `weight-entry`) ont disparu avec le passage aux
 * profils authentifiés : ils servaient à rejouer un résultat vers des appareils SANS profil, un
 * mode qui n'existe plus (la file exige désormais une session). Le résultat d'un traitement
 * remonte maintenant par les tables d'entité (profileSync), ce qui évite d'écrire une deuxième
 * fois le contenu des repas dans une table partagée.
 */
export type SyncKind = 'transcript' | 'image' | 'sun' | 'weight';

interface SyncRow<T> {
  id: string;
  device: string;
  /** Toujours renseigné depuis la migration 0001 ; `null` possible sur d'anciennes lignes (pré-migration). */
  profile_id: string | null;
  kind: SyncKind;
  payload: T;
  processed: boolean;
  created_at: string;
}

/** Tentatives et délai de base (ms) du backoff pour les dépôts sur Supabase. */
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Exécute un dépôt Supabase avec quelques tentatives et un backoff exponentiel.
 * Vise surtout le « TypeError: Failed to fetch » des connexions mobiles qui
 * flottent : le `fetch` échoue AVANT toute réponse (le POST n'est jamais arrivé),
 * donc rejouer la même requête un instant plus tard aboutit souvent. Un échec
 * PostgREST renvoyé dans `{ error }` (droits, colonne…) est déterministe : on le
 * rejoue aussi mais il finira par remonter, avec `label` pour situer l'appel.
 */
async function withRetry(
  label: string,
  op: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  let lastMessage = 'échec inconnu';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { error } = await op();
      if (!error) return;
      lastMessage = error.message;
    } catch (e) {
      // fetch rejeté (réseau coupé/instable) → TypeError « Failed to fetch ».
      lastMessage = (e as Error).message;
    }
    if (attempt < MAX_ATTEMPTS) {
      console.warn(`[sync] ${label} : échec tentative ${attempt}/${MAX_ATTEMPTS} (${lastMessage}), nouvelle tentative…`);
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw new Error(`${label} : ${lastMessage} (après ${MAX_ATTEMPTS} tentatives)`);
}

/** Dépose une transcription en attente de traitement par un autre appareil du MÊME profil. */
export async function pushTranscript(device: string, profileId: string, transcript: string, date?: string, clientTime?: number): Promise<void> {
  if (!supabase) return;
  const payload: TranscriptPayload = { transcript, ...(date ? { date } : {}), ...(clientTime ? { clientTime } : {}) };
  await withRetry('envoi de la dictée', () =>
    supabase!.from('sync_queue').insert({ device, profile_id: profileId, kind: 'transcript', payload, processed: false }),
  );
}

/** Dépose une photo (réduite) en attente d'analyse par un autre appareil du MÊME profil. */
export async function pushImage(device: string, profileId: string, imageBase64: string, mediaType: string, date?: string, clientTime?: number): Promise<void> {
  if (!supabase) return;
  const payload: ImagePayload = { imageBase64, mediaType, ...(date ? { date } : {}), ...(clientTime ? { clientTime } : {}) };
  await withRetry('envoi de la photo', () =>
    supabase!.from('sync_queue').insert({ device, profile_id: profileId, kind: 'image', payload, processed: false }),
  );
}

/** Lignes en attente d'un kind donné (tous appareils confondus), plus anciennes d'abord. */
async function fetchPending<T>(kind: SyncKind): Promise<SyncRow<T>[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('sync_queue')
    .select('*')
    .eq('kind', kind)
    .eq('processed', false)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SyncRow<T>[];
}

/**
 * Compte les lignes en attente par kind, SANS rapatrier les payloads : une photo pèse
 * plusieurs centaines de Ko, et les appareils sans pont (téléphone) n'ont besoin que du
 * nombre — ils ne traitent rien. Sert au bandeau « en attente de traitement par l'ordinateur ».
 */
export async function countPending(): Promise<Record<SyncKind, number>> {
  const counts: Record<SyncKind, number> = { transcript: 0, image: 0, sun: 0, weight: 0 };
  if (!supabase) return counts;
  const { data, error } = await supabase.from('sync_queue').select('kind').eq('processed', false);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as { kind: string }[]) {
    // D'anciennes lignes peuvent porter un kind disparu (cf. les kinds « résultat ») : on les ignore.
    if (row.kind in counts) counts[row.kind as SyncKind] += 1;
  }
  return counts;
}

/** Récupère les transcriptions en attente (tous appareils confondus). */
export function fetchPendingTranscripts(): Promise<SyncRow<TranscriptPayload>[]> {
  return fetchPending<TranscriptPayload>('transcript');
}

/** Récupère les photos en attente (tous appareils confondus). */
export function fetchPendingImages(): Promise<SyncRow<ImagePayload>[]> {
  return fetchPending<ImagePayload>('image');
}

/** Récupère les dictées « soleil » en attente d'analyse. */
export function fetchPendingSun(): Promise<SyncRow<TranscriptPayload>[]> {
  return fetchPending<TranscriptPayload>('sun');
}

/** Dépose une dictée « soleil » en attente d'analyse par un autre appareil du MÊME profil. */
export async function pushSunTranscript(device: string, profileId: string, transcript: string, date?: string, clientTime?: number): Promise<void> {
  if (!supabase) return;
  const payload: TranscriptPayload = { transcript, ...(date ? { date } : {}), ...(clientTime ? { clientTime } : {}) };
  await withRetry('envoi de la dictée soleil', () =>
    supabase!.from('sync_queue').insert({ device, profile_id: profileId, kind: 'sun', payload, processed: false }),
  );
}

/** Récupère les dictées de pesée en attente d'analyse. */
export function fetchPendingWeight(): Promise<SyncRow<TranscriptPayload>[]> {
  return fetchPending<TranscriptPayload>('weight');
}

/** Dépose une dictée de pesée en attente d'analyse par un autre appareil du MÊME profil. */
export async function pushWeightTranscript(device: string, profileId: string, transcript: string, date?: string, clientTime?: number): Promise<void> {
  if (!supabase) return;
  const payload: TranscriptPayload = { transcript, ...(date ? { date } : {}), ...(clientTime ? { clientTime } : {}) };
  await withRetry('envoi de la dictée de pesée', () =>
    supabase!.from('sync_queue').insert({ device, profile_id: profileId, kind: 'weight', payload, processed: false }),
  );
}

/** Marque une ligne en attente (dictée ou photo) comme traitée, pour ne pas boucler dessus. */
export async function markProcessed(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('sync_queue').update({ processed: true }).eq('id', id);
}

/**
 * Marque une photo comme traitée en purgeant son base64 (`sync_queue.payload` peut sinon
 * accumuler des centaines de Ko par photo indéfiniment). En cas de succès, `payload` ne porte
 * plus que les métadonnées (mediaType/date/clientTime) ; en cas d'échec, on garde le base64 et on
 * ajoute `error` pour permettre un diagnostic — la ligne reste `processed` pour ne pas reboucler.
 */
export async function markImageProcessed(id: string, payload: Omit<ImagePayload, 'imageBase64'> | ImagePayload): Promise<void> {
  if (!supabase) return;
  await supabase.from('sync_queue').update({ processed: true, payload }).eq('id', id);
}
