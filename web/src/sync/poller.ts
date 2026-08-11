import { useStore, todayStr, nowTime, effectiveFoods, recentFoodCounts } from '../store/store';
import { checkClaudeCode, extractWithClaudeCode, extractImageWithClaudeCode } from '../extraction/claudeCode';
import { verifyMatches } from '../extraction/verify';
import { extractSun } from '../extraction/sun';
import { extractWeight, completeWeightEntry } from '../extraction/weight';
import { completeSunExposure, SUN_FALLBACK } from '../sun/vitaminD';
import {
  fetchPendingTranscripts,
  fetchPendingImages,
  fetchPendingSun,
  fetchPendingWeight,
  markProcessed,
  markImageProcessed,
  isSyncConfigured,
} from './supabase';
import { useSyncStore } from './syncStore';

let running = false;

/**
 * Un « tick » de la file d'attente, à appeler périodiquement (voir App.tsx) : si ce poste a le
 * pont Claude Code disponible (ordinateur, npm run dev), il traite les dictées, photos, sorties
 * soleil et pesées déposées par les AUTRES appareils du même profil, et les enregistre dans son
 * journal local. La diffusion vers les autres appareils est ensuite assurée par la synchro d'état
 * (`profileSync`), pas par cette file.
 *
 * No-op silencieux si Supabase n'est pas configuré, sans profil connecté, ou session expirée :
 * depuis la migration 0001, `sync_queue` est cloisonnée par profil et exige un jeton valide.
 */
export async function runSyncTick(): Promise<void> {
  const { profileId, sessionExpired } = useSyncStore.getState();
  if (!isSyncConfigured() || !profileId || sessionExpired || running) return;
  running = true;
  try {
    const {
      extractionMode,
      cloudApiKey,
      cloudModel,
      customFoods,
      entries,
      addEntry,
      addSunExposure,
      addWeightEntry,
    } = useStore.getState();

    /** Laisse l'IA forte juger les correspondances incertaines (cf. extraction/verify.ts). */
    const verify = (items: Awaited<ReturnType<typeof extractWithClaudeCode>>['items']) =>
      verifyMatches(
        items,
        effectiveFoods(customFoods),
        'claudecode',
        cloudApiKey,
        cloudModel,
        recentFoodCounts(entries),
      );

    if (extractionMode === 'claudecode') {
      const status = await checkClaudeCode();
      if (status.available) {
        // Transcriptions vocales en attente.
        const pending = await fetchPendingTranscripts();
        for (const row of pending) {
          try {
            const res = await extractWithClaudeCode(row.payload.transcript);
            if (res.items.length > 0) {
              const items = res.source === 'claudecode' ? await verify(res.items) : res.items;
              // Heure/jour = ceux estampillés par l'émetteur à l'envoi (cf. supabase.ts),
              // pas l'heure de CE traitement différé. L'entrée remonte ensuite aux autres
              // appareils par la synchro d'état (profileSync), avec un id unique.
              addEntry(row.payload.transcript, items, res.source, row.payload.date, row.payload.clientTime);
            }
          } catch {
            // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
          }
          await markProcessed(row.id);
        }

        // Photos en attente (analysées par le CLI multimodal). Succès → le base64 est purgé de
        // la ligne (voir markImageProcessed) ; échec → il est gardé avec l'erreur pour diagnostic,
        // au lieu d'être avalé silencieusement comme avant.
        const pendingImages = await fetchPendingImages();
        for (const row of pendingImages) {
          try {
            const res = await extractImageWithClaudeCode(row.payload.imageBase64, row.payload.mediaType);
            if (res.items.length > 0) {
              const items = await verify(res.items);
              addEntry('📷 Photo', items, res.source, row.payload.date, row.payload.clientTime);
            }
            const kept: Omit<typeof row.payload, 'imageBase64'> = {
              mediaType: row.payload.mediaType,
              date: row.payload.date,
              clientTime: row.payload.clientTime,
              // Traité sans erreur technique, mais rien à ajouter : distingue ce cas d'un
              // vrai succès dans le diagnostic (colonne payload.error), au lieu de rester
              // muet comme avant (cf. photo du 11/08 : traitée, 0 item, aucune trace).
              ...(res.items.length === 0 ? { error: 'Aucun aliment détecté sur la photo.' } : {}),
            };
            await markImageProcessed(row.id, kept);
          } catch (e) {
            console.error('[sync] échec extraction photo', row.id, e);
            await markImageProcessed(row.id, { ...row.payload, error: (e as Error).message });
          }
        }

        // Dictées « soleil » en attente : même chemin qu'un repas — le poste qui a
        // le pont analyse et enregistre, la synchro d'état diffuse ensuite.
        const pendingSun = await fetchPendingSun();
        for (const row of pendingSun) {
          try {
            const { sorties, source } = await extractSun(row.payload.transcript, 'claudecode', cloudApiKey, cloudModel);
            if (sorties.length > 0 && source === 'claudecode') {
              // Ce poste n'a pas le formulaire de l'appareil qui a dicté : les
              // champs non dits prennent les valeurs de repli. Le jour ciblé est
              // celui estampillé par l'émetteur (sinon aujourd'hui), et l'heure de
              // saisie = son heure d'envoi, pas ce traitement différé.
              const defaults = { ...SUN_FALLBACK, date: row.payload.date ?? todayStr() };
              const complete = sorties.map((p) => completeSunExposure(p, defaults));
              for (const e of complete) addSunExposure(e, row.payload.clientTime);
            }
          } catch {
            // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
          }
          await markProcessed(row.id);
        }

        // Dictées de pesée en attente : même chemin que le soleil. Ce poste n'a
        // pas le formulaire de l'appareil qui a dicté — les champs non dits
        // prennent les valeurs de repli (à jeun, nu), le jour est celui
        // estampillé par l'émetteur et l'heure celle de son envoi.
        const pendingWeight = await fetchPendingWeight();
        for (const row of pendingWeight) {
          try {
            const { patch, source } = await extractWeight(row.payload.transcript, 'claudecode', cloudApiKey, cloudModel);
            const stamp = row.payload.clientTime ? new Date(row.payload.clientTime) : new Date();
            const pesee =
              source === 'claudecode'
                ? completeWeightEntry(patch, {
                    date: row.payload.date ?? todayStr(stamp),
                    heure: nowTime(stamp),
                    source: 'claudecode',
                  })
                : null;
            if (pesee) addWeightEntry(pesee, row.payload.clientTime);
          } catch {
            // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
          }
          await markProcessed(row.id);
        }
      }
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
    running = false;
  }
}
