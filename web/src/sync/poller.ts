import { useStore, todayStr, nowTime, effectiveFoods, recentFoodCounts, cloudConfigOf } from '../store/store';
import { extractWithCli, extractImageWithCli } from '../extraction/cliExtract';
import { checkBridge } from '../extraction/bridge';
import { verifyMatches } from '../extraction/verify';
import { extractSun } from '../extraction/sun';
import { extractWeight, completeWeightEntry } from '../extraction/weight';
import { completeSunExposure, SUN_FALLBACK } from '../sun/vitaminD';
import {
  fetchPendingTranscripts,
  fetchPendingImages,
  fetchPendingSun,
  fetchPendingWeight,
  summarizePending,
  pendingItemOf,
  markProcessed,
  markImageProcessed,
  isSyncConfigured,
  type PendingItem,
  type SyncKind,
} from './supabase';
import { useSyncStore } from './syncStore';
import { useQueueStatus, pendingTotal, type PendingCounts } from './queueStatus';

let running = false;

/**
 * Un « tick » de la file d'attente, à appeler périodiquement (voir App.tsx) : si ce poste a le
 * pont Claude Code disponible (ordinateur, npm run dev), il traite les dictées, photos, sorties
 * soleil et pesées déposées par les AUTRES appareils du même profil, et les enregistre dans son
 * journal local. La diffusion vers les autres appareils est ensuite assurée par la synchro d'état
 * (`profileSync`), pas par cette file.
 *
 * L'avancement est publié dans `useQueueStatus` au fil de l'eau (cf. le bandeau de l'onglet du
 * jour) : ce qui reste à traiter, ce que le CLI mâche à l'instant, ce qui est passé et ce qui a
 * échoué. Les postes SANS pont (téléphone) ne peuvent pas traiter la file : ils se contentent de
 * la compter, pour annoncer l'attente sans prétendre savoir si l'ordinateur est allumé.
 *
 * No-op silencieux si Supabase n'est pas configuré, sans profil connecté, ou session expirée :
 * depuis la migration 0001, `sync_queue` est cloisonnée par profil et exige un jeton valide.
 */
export async function runSyncTick(): Promise<void> {
  const { profileId, sessionExpired } = useSyncStore.getState();
  if (!isSyncConfigured() || !profileId || sessionExpired || running) return;
  running = true;
  const queue = useQueueStatus.getState();
  try {
    const {
      extractionMode,
      customFoods,
      entries,
      addEntry,
      addSunExposure,
      addWeightEntry,
    } = useStore.getState();

    /** Laisse l'IA forte juger les correspondances incertaines (cf. extraction/verify.ts). */
    // La file d'attente est traitée par le PONT (c'est tout son intérêt : le
    // téléphone délègue à l'ordinateur), jamais par une clé API — d'où une
    // config « clé API » inerte passée à verifyMatches, qui n'en fera rien.
    const cloud = cloudConfigOf(useStore.getState());
    const verify = (items: Awaited<ReturnType<typeof extractWithCli>>['items']) =>
      verifyMatches(items, effectiveFoods(customFoods), 'claudecode', cloud, recentFoodCounts(entries));

    const bridge = extractionMode === 'claudecode' ? await checkBridge() : { available: false };
    queue.setBridge(bridge.available);

    if (!bridge.available) {
      // Ce poste ne traite rien (téléphone, ou extraction non confiée au pont) : il relève
      // seulement ce qui attend, en colonnes légères — inutile de rapatrier des photos en
      // base64 pour afficher « 2 en attente » et le détail de chaque ligne.
      const summary = await summarizePending();
      queue.setPending(summary.counts, summary.items);
      return;
    }

    // Les quatre kinds sont relevés d'un bloc, alors qu'ils étaient récupérés au fil des
    // boucles : le total doit être connu AVANT le premier appel au CLI, sans quoi le
    // bandeau afficherait « 1/1 » à répétition au lieu de « 2/5 ».
    const [pendingTranscripts, pendingImages, pendingSun, pendingWeight] = await Promise.all([
      fetchPendingTranscripts(),
      fetchPendingImages(),
      fetchPendingSun(),
      fetchPendingWeight(),
    ]);
    const counts: PendingCounts = {
      transcript: pendingTranscripts.length,
      image: pendingImages.length,
      sun: pendingSun.length,
      weight: pendingWeight.length,
    };
    const total = pendingTotal(counts);
    // Détail affichable, tiré des lignes déjà en main (aucune requête de plus) et remis
    // dans l'ordre d'envoi, celui que l'utilisateur reconnaît — pas l'ordre de traitement.
    let items: PendingItem[] = [...pendingTranscripts, ...pendingImages, ...pendingSun, ...pendingWeight]
      .map(pendingItemOf)
      .sort((a, b) => a.sentAt - b.sentAt);
    queue.setPending(counts, items);
    if (total === 0) return;

    let index = 0;
    /** Une ligne part au CLI : le bandeau annonce laquelle, et son rang dans le lot. */
    const begin = (kind: SyncKind) => {
      index += 1;
      queue.setCurrent({ kind, index, total });
    };
    /**
     * Une ligne quitte la file. `failure` renseigné = traitée sans résultat exploitable :
     * comptée à part et affichée avec son motif, au lieu d'être avalée en silence comme
     * avant (cf. la photo du 11/08 : traitée, 0 item, aucune trace).
     */
    const finish = (id: string, kind: SyncKind, failure?: string) => {
      counts[kind] -= 1;
      items = items.filter((i) => i.id !== id);
      queue.setPending({ ...counts }, items);
      if (failure) queue.recordFailure({ kind, message: failure });
      else queue.recordDone();
    };

    // Transcriptions vocales en attente.
    for (const row of pendingTranscripts) {
      begin('transcript');
      let failure: string | undefined;
      try {
        const res = await extractWithCli(row.payload.transcript);
        if (res.items.length > 0) {
          const items = res.source === 'rules' ? res.items : await verify(res.items);
          // Heure/jour = ceux estampillés par l'émetteur à l'envoi (cf. supabase.ts),
          // pas l'heure de CE traitement différé. L'entrée remonte ensuite aux autres
          // appareils par la synchro d'état (profileSync), avec un id unique.
          addEntry(row.payload.transcript, items, res.source, row.payload.date, row.payload.clientTime);
        } else {
          failure = 'Aucun aliment reconnu dans la dictée.';
        }
      } catch (e) {
        // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
        failure = (e as Error).message;
      }
      await markProcessed(row.id);
      finish(row.id, 'transcript', failure);
    }

    // Photos en attente (analysées par le CLI multimodal). Succès → le base64 est purgé de
    // la ligne (voir markImageProcessed) ; échec → il est gardé avec l'erreur pour diagnostic,
    // au lieu d'être avalé silencieusement comme avant.
    for (const row of pendingImages) {
      begin('image');
      let failure: string | undefined;
      try {
        const res = await extractImageWithCli(row.payload.imageBase64, row.payload.mediaType);
        if (res.items.length > 0) {
          const items = await verify(res.items);
          addEntry('📷 Photo', items, res.source, row.payload.date, row.payload.clientTime);
        } else {
          // Traité sans erreur technique, mais rien à ajouter : distingue ce cas d'un
          // vrai succès, dans le diagnostic (colonne payload.error) comme dans le bandeau.
          failure = 'Aucun aliment détecté sur la photo.';
        }
        const kept: Omit<typeof row.payload, 'imageBase64'> = {
          mediaType: row.payload.mediaType,
          date: row.payload.date,
          clientTime: row.payload.clientTime,
          ...(failure ? { error: failure } : {}),
        };
        await markImageProcessed(row.id, kept);
      } catch (e) {
        failure = (e as Error).message;
        console.error('[sync] échec extraction photo', row.id, e);
        await markImageProcessed(row.id, { ...row.payload, error: failure });
      }
      finish(row.id, 'image', failure);
    }

    // Dictées « soleil » en attente : même chemin qu'un repas — le poste qui a
    // le pont analyse et enregistre, la synchro d'état diffuse ensuite.
    for (const row of pendingSun) {
      begin('sun');
      let failure: string | undefined;
      try {
        const { sorties, source } = await extractSun(row.payload.transcript, 'claudecode', cloud);
        if (sorties.length > 0 && source !== 'rules') {
          // Ce poste n'a pas le formulaire de l'appareil qui a dicté : les
          // champs non dits prennent les valeurs de repli. Le jour ciblé est
          // celui estampillé par l'émetteur (sinon aujourd'hui), et l'heure de
          // saisie = son heure d'envoi, pas ce traitement différé.
          const defaults = { ...SUN_FALLBACK, date: row.payload.date ?? todayStr() };
          const complete = sorties.map((p) => completeSunExposure(p, defaults));
          for (const e of complete) addSunExposure(e, row.payload.clientTime);
        } else {
          failure = 'Aucune sortie au soleil reconnue dans la dictée.';
        }
      } catch (e) {
        failure = (e as Error).message;
      }
      await markProcessed(row.id);
      finish(row.id, 'sun', failure);
    }

    // Dictées de pesée en attente : même chemin que le soleil. Ce poste n'a
    // pas le formulaire de l'appareil qui a dicté — les champs non dits
    // prennent les valeurs de repli (à jeun, nu), le jour est celui
    // estampillé par l'émetteur et l'heure celle de son envoi.
    for (const row of pendingWeight) {
      begin('weight');
      let failure: string | undefined;
      try {
        const { patch, source } = await extractWeight(row.payload.transcript, 'claudecode', cloud);
        const stamp = row.payload.clientTime ? new Date(row.payload.clientTime) : new Date();
        const pesee =
          source !== 'rules'
            ? completeWeightEntry(patch, {
                date: row.payload.date ?? todayStr(stamp),
                heure: nowTime(stamp),
                source,
              })
            : null;
        if (pesee) addWeightEntry(pesee, row.payload.clientTime);
        else failure = 'Aucun poids reconnu dans la dictée.';
      } catch (e) {
        failure = (e as Error).message;
      }
      await markProcessed(row.id);
      finish(row.id, 'weight', failure);
    }

    // Le rejeu des résultats traités par d'AUTRES appareils est pris en charge par
    // la sync d'état (profileSync, toujours active ici — cf. garde en tête de
    // fonction) : chaque appareil recevrait sinon ces résultats avec un id local
    // DIFFÉRENT, créant des doublons. Le pont (ci-dessus) continue de traiter et
    // son `addEntry` local remonte aux autres appareils par la sync d'état.
  } catch {
    // Réseau coupé, Supabase injoignable, projet en pause… : la synchro est un
    // confort, jamais un bloquant. Sans ce filet, une simple perte de connexion
    // rejetait une promesse non gérée à chaque tick (toutes les 20 s).
  } finally {
    // Plus rien en cours d'analyse sur ce poste, y compris si le tick s'est
    // interrompu en route : sans ça le bandeau resterait figé sur « photo 2/5 ».
    queue.setCurrent(null);
    running = false;
  }
}
