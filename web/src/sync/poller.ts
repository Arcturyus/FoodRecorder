import { useStore } from '../store/store';
import { checkClaudeCode, extractWithClaudeCode, extractImageWithClaudeCode } from '../extraction/claudeCode';
import {
  fetchPendingTranscripts,
  fetchPendingImages,
  markProcessed,
  pushEntry,
  fetchNewEntries,
  isSyncConfigured,
} from './supabase';

let running = false;

/**
 * Un « tick » de synchro, à appeler périodiquement (voir App.tsx) :
 * 1. Si ce poste a le pont Claude Code disponible (ordinateur, npm run dev),
 *    traite les transcriptions en attente déposées par d'autres appareils.
 * 2. Récupère les entrées déjà traitées par d'autres appareils et les ajoute
 *    au journal local.
 * No-op silencieux si Supabase n'est pas configuré.
 */
export async function runSyncTick(): Promise<void> {
  if (!isSyncConfigured() || running) return;
  running = true;
  try {
    const { deviceId, syncCursor, extractionMode, addEntry, setSyncCursor } = useStore.getState();

    if (extractionMode === 'claudecode') {
      const status = await checkClaudeCode();
      if (status.available) {
        // Transcriptions vocales en attente.
        const pending = await fetchPendingTranscripts();
        for (const row of pending) {
          try {
            const res = await extractWithClaudeCode(row.payload.transcript);
            if (res.items.length > 0) {
              addEntry(row.payload.transcript, res.items, res.source, row.payload.date);
              if (res.source === 'claudecode') {
                await pushEntry(deviceId, {
                  transcript: row.payload.transcript,
                  items: res.items,
                  source: 'claudecode',
                  ...(row.payload.date ? { date: row.payload.date } : {}),
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
              addEntry('📷 Photo', res.items, res.source, row.payload.date);
              await pushEntry(deviceId, {
                transcript: '📷 Photo',
                items: res.items,
                source: 'claudecode',
                ...(row.payload.date ? { date: row.payload.date } : {}),
              });
            }
          } catch {
            // Échec ponctuel : on marque quand même la ligne traitée pour ne pas boucler dessus.
          }
          await markProcessed(row.id);
        }
      }
    }

    const newEntries = await fetchNewEntries(deviceId, syncCursor);
    for (const row of newEntries) {
      addEntry(row.payload.transcript, row.payload.items, row.payload.source, row.payload.date);
    }
    if (newEntries.length > 0) {
      setSyncCursor(newEntries[newEntries.length - 1].created_at);
    }
  } finally {
    running = false;
  }
}
