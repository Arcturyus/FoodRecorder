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
  pushEntry,
  pushSunEntry,
  pushWeightEntry,
  fetchNewEntries,
  isSyncConfigured,
} from './supabase';
import type { SunPayloadExposure } from './supabase';
import { useSyncStore } from './syncStore';

let running = false;

/**
 * Un « tick » de synchro, à appeler périodiquement (voir App.tsx) :
 * 1. Si ce poste a le pont Claude Code disponible (ordinateur, npm run dev),
 *    traite les transcriptions, photos et dictées « soleil » en attente
 *    déposées par d'autres appareils.
 * 2. Récupère les résultats déjà traités par d'autres appareils (repas et
 *    sorties au soleil) et les ajoute au journal local.
 * No-op silencieux si Supabase n'est pas configuré.
 */
export async function runSyncTick(): Promise<void> {
  if (!isSyncConfigured() || running) return;
  running = true;
  try {
    const {
      deviceId,
      syncCursor,
      extractionMode,
      cloudApiKey,
      cloudModel,
      customFoods,
      foodOverrides,
      entries,
      addEntry,
      addSunExposure,
      addWeightEntry,
      setSyncCursor,
    } = useStore.getState();

    /** Laisse l'IA forte juger les correspondances incertaines (cf. extraction/verify.ts). */
    const verify = (items: Awaited<ReturnType<typeof extractWithClaudeCode>>['items']) =>
      verifyMatches(
        items,
        effectiveFoods(customFoods, foodOverrides),
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
              // pas l'heure de CE traitement différé.
              addEntry(row.payload.transcript, items, res.source, row.payload.date, row.payload.clientTime);
              if (res.source === 'claudecode') {
                await pushEntry(deviceId, {
                  transcript: row.payload.transcript,
                  items,
                  source: 'claudecode',
                  ...(row.payload.date ? { date: row.payload.date } : {}),
                  ...(row.payload.clientTime ? { clientTime: row.payload.clientTime } : {}),
                });
              }
            }
          } catch {
            // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
          }
          await markProcessed(row.id);
        }

        // Photos en attente (analysées par le CLI multimodal).
        const pendingImages = await fetchPendingImages();
        for (const row of pendingImages) {
          try {
            const res = await extractImageWithClaudeCode(row.payload.imageBase64, row.payload.mediaType);
            if (res.items.length > 0) {
              const items = await verify(res.items);
              addEntry('📷 Photo', items, res.source, row.payload.date, row.payload.clientTime);
              await pushEntry(deviceId, {
                transcript: '📷 Photo',
                items,
                source: 'claudecode',
                ...(row.payload.date ? { date: row.payload.date } : {}),
                ...(row.payload.clientTime ? { clientTime: row.payload.clientTime } : {}),
              });
            }
          } catch {
            // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
          }
          await markProcessed(row.id);
        }

        // Dictées « soleil » en attente : même chemin qu'un repas — le poste qui a
        // le pont analyse, enregistre, et republie pour les autres appareils.
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
              await pushSunEntry(deviceId, {
                transcript: row.payload.transcript,
                sorties: complete,
                ...(row.payload.date ? { date: row.payload.date } : {}),
                ...(row.payload.clientTime ? { clientTime: row.payload.clientTime } : {}),
              });
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
            if (pesee) {
              addWeightEntry(pesee, row.payload.clientTime);
              await pushWeightEntry(deviceId, {
                transcript: row.payload.transcript,
                pesee,
                ...(row.payload.date ? { date: row.payload.date } : {}),
                ...(row.payload.clientTime ? { clientTime: row.payload.clientTime } : {}),
              });
            }
          } catch {
            // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
          }
          await markProcessed(row.id);
        }
      }
    }

    // Quand un profil de synchro est actif, le rejeu des résultats est pris en
    // charge par la sync d'état (profileSync) : chaque appareil recevrait sinon
    // ces résultats avec un id local DIFFÉRENT, créant des doublons dans le
    // profil. Le pont (ci-dessus) continue de traiter et son `addEntry` local
    // remonte aux autres appareils par la sync d'état, avec un id unique.
    if (useSyncStore.getState().profileId == null) {
      const newRows = await fetchNewEntries(deviceId, syncCursor);
      for (const row of newRows) {
        // Rejeu d'un résultat traité par un AUTRE appareil : on réutilise l'heure/le
        // jour d'origine (estampillés par l'émetteur), pas l'heure de réception ici.
        if (row.kind === 'sun-entry') {
          for (const e of row.payload.sorties as SunPayloadExposure[]) addSunExposure(e, row.payload.clientTime);
        } else if (row.kind === 'weight-entry') {
          addWeightEntry(row.payload.pesee, row.payload.clientTime);
        } else {
          addEntry(row.payload.transcript, row.payload.items, row.payload.source, row.payload.date, row.payload.clientTime);
        }
      }
      if (newRows.length > 0) {
        setSyncCursor(newRows[newRows.length - 1].created_at);
      }
    }
  } catch {
    // Réseau coupé, Supabase injoignable, projet en pause… : la synchro est un
    // confort, jamais un bloquant. Sans ce filet, une simple perte de connexion
    // rejetait une promesse non gérée à chaque tick (toutes les 20 s).
  } finally {
    running = false;
  }
}
