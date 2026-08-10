/**
 * Accès Supabase pour les profils et leurs tables par entité. Couche fine
 * (mêmes conventions que `supabase.ts`) : chaque fonction lève une Error en cas
 * d'échec, le moteur de sync décide quoi en faire. Le schéma est dans
 * `supabase/migrations/` (et le mode opératoire dans `supabase/README.md`).
 */

import { supabase } from './supabase';
import type { EntityTable } from './collections';

/** Nom de table synchronisée (entités + singleton clé/valeur). */
export type SyncTable = EntityTable | 'profile_kv';

export interface ProfileRow {
  id: string;
  name: string;
}

/** Une ligne d'une table synchronisée telle que stockée/reçue. */
export interface DbRow {
  profile_id: string;
  /** Id client (tables entité). */
  id?: string;
  /** Clé (table `profile_kv`). */
  key?: string;
  payload: unknown;
  updated_at: number;
  deleted: boolean;
  device: string | null;
  synced_at?: string;
}

function client() {
  if (!supabase) throw new Error('Synchronisation non configurée (Supabase absent).');
  return supabase;
}

/** Erreur Supabase enrichie du code PostgREST, pour distinguer un jeton mort d'une panne réseau. */
export interface SyncError extends Error {
  /** Code PostgREST / Postgres (`PGRST301` = JWT expiré, `42501` = droits insuffisants…). */
  code?: string;
}

/**
 * Transforme une erreur PostgREST en `Error` en CONSERVANT son code. Sans lui, l'appelant en est
 * réduit à deviner la nature du problème depuis le texte du message — ce qui confondait une
 * session expirée (à laquelle il faut réagir en redemandant le mot de passe) avec un simple refus
 * de droits ou une coupure réseau.
 */
function toSyncError(error: { message: string; code?: string }): SyncError {
  const e = new Error(error.message) as SyncError;
  if (error.code) e.code = error.code;
  return e;
}

/** Codes signalant que le jeton n'est plus accepté (expiré, invalide, ou révoqué). */
const AUTH_ERROR_CODES = new Set(['PGRST301', 'PGRST302', '42501']);

/** Cette erreur veut-elle dire « il faut se reconnecter » ? */
export function isAuthError(e: unknown): boolean {
  const code = (e as SyncError | null)?.code;
  return code != null && AUTH_ERROR_CODES.has(code);
}

/** Résultat d'une connexion/création réussie. Le jeton est géré par supabase-js, pas par nous. */
export interface AuthResult {
  id: string;
  name: string;
}

/** Domaine non routable des comptes de profil (RFC 6761 : `.invalid` n'existera jamais pour de vrai). */
const PROFILE_EMAIL_DOMAIN = 'foodrecorder.invalid';

/**
 * Adresse technique du compte Auth associé à un nom de profil.
 *
 * Supabase Auth s'authentifie par e-mail : comme un profil n'en a pas, on en dérive une, stable et
 * non routable. La normalisation (accents retirés, minuscules, tout le reste en tirets) rend
 * « Romain » et « romain » équivalents, comme l'était la recherche insensible à la casse d'avant.
 * Conséquence assumée : deux noms qui se réduisent au même slug ne peuvent pas coexister — le
 * second reçoit « ce nom est déjà utilisé ».
 */
export function profileEmail(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // « é » → « e » (NFD a isolé l'accent, on le retire)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Nom de profil invalide : il faut au moins une lettre ou un chiffre.');
  return `${slug}@${PROFILE_EMAIL_DOMAIN}`;
}

/** Le profil rattaché au compte connecté (via la fonction SQL `create_or_claim_profile`). */
async function resolveProfile(name: string): Promise<AuthResult> {
  const { data, error } = await client().rpc('create_or_claim_profile', { p_name: name.trim() });
  if (error) throw toSyncError(error);
  const row = (data as { profile_id: string; profile_name: string }[] | null)?.[0];
  if (!row) throw new Error('Profil introuvable après connexion.');
  return { id: row.profile_id, name: row.profile_name };
}

/**
 * Connexion à un profil dont le compte existe déjà. Message volontairement identique quel que soit
 * le motif (nom inconnu ou mot de passe faux) : distinguer les deux permettrait de savoir quels
 * profils existent.
 */
export async function loginProfile(name: string, password: string): Promise<AuthResult> {
  const { error } = await client().auth.signInWithPassword({ email: profileEmail(name), password });
  if (error) throw new Error('Nom ou mot de passe incorrect.');
  return resolveProfile(name);
}

/**
 * Crée le compte d'un profil — et ADOPTE au passage un profil existant qui n'en a pas encore
 * (voir `create_or_claim_profile` côté SQL). C'est le chemin de migration des profils d'avant
 * l'authentification : ils vivent en base sans compte rattaché, et le premier à se présenter avec
 * le bon nom se les approprie.
 */
export async function signupProfile(name: string, password: string): Promise<AuthResult> {
  const email = profileEmail(name);
  const { data, error } = await client().auth.signUp({ email, password });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) {
      throw new Error('Ce nom de profil est déjà utilisé. Utilisez « Rejoindre » pour vous y connecter.');
    }
    throw new Error(error.message);
  }
  // Sans session, la confirmation d'e-mail est active côté projet : elle ne peut pas fonctionner
  // ici (l'adresse est fictive et ne reçoit rien), et tout appel suivant serait non authentifié.
  if (!data.session) {
    throw new Error(
      'Le projet Supabase exige une confirmation d’e-mail : désactivez « Confirm email » ' +
        '(Authentication → Sign In / Providers → Email), les adresses de profil étant fictives.',
    );
  }
  return resolveProfile(name);
}

/** Ferme la session Supabase (le profil local reste en place, il n'est simplement plus synchronisé). */
export async function signOut(): Promise<void> {
  if (supabase) await supabase.auth.signOut();
}

/** Y a-t-il une session Supabase valide en cours ? (au démarrage, après réhydratation) */
export async function hasValidSession(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.getSession();
  return data.session != null;
}

/**
 * Renomme un profil (id stable). Ne touche QUE la colonne `name` : c'est la seule que la migration
 * 0002 accorde au rôle `authenticated` (`grant update (name)`), tout le reste de `profiles` passant
 * par l'Edge Function. Écrire `updated_at` au passage ferait échouer la requête entière.
 */
export async function renameProfile(id: string, name: string): Promise<void> {
  const { error } = await client().from('profiles').update({ name: name.trim() }).eq('id', id);
  if (error) throw error.code === '23505' ? new Error('Ce nom est déjà pris.') : toSyncError(error);
}

/** Lignes d'une table modifiées depuis `cursor` par d'AUTRES appareils (anti-écho). */
export async function fetchRowsSince(
  table: SyncTable,
  profileId: string,
  cursor: string | null,
  deviceId: string,
): Promise<DbRow[]> {
  let q = client().from(table).select('*').eq('profile_id', profileId).neq('device', deviceId);
  if (cursor) q = q.gt('synced_at', cursor);
  const { data, error } = await q;
  if (error) throw toSyncError(error);
  return (data ?? []) as DbRow[];
}

/** Toutes les lignes vivantes (non supprimées) d'une table pour un profil. */
export async function fetchAllRows(table: SyncTable, profileId: string): Promise<DbRow[]> {
  const { data, error } = await client().from(table).select('*').eq('profile_id', profileId).eq('deleted', false);
  if (error) throw toSyncError(error);
  return (data ?? []) as DbRow[];
}

/** Nombre de lignes vivantes d'une table (pour éclairer le choix à la jonction). */
export async function countRows(table: SyncTable, profileId: string): Promise<number> {
  const { count, error } = await client()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('deleted', false);
  if (error) throw toSyncError(error);
  return count ?? 0;
}

/** Upsert par lots de 500 (le push initial d'un journal complet peut être volumineux). */
export async function upsertRows(table: SyncTable, rows: DbRow[]): Promise<void> {
  if (rows.length === 0) return;
  const onConflict = table === 'profile_kv' ? 'profile_id,key' : 'profile_id,id';
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client().from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw toSyncError(error);
  }
}
