import { initChangeTracker } from './sync/changeTracker';
import { runProfileSyncTick, restoreSession } from './sync/profileSync';
import { useSyncStore } from './sync/syncStore';
import { runSyncTick } from './sync/poller';
import { useQueueStatus, pendingTotal } from './sync/queueStatus';
import { isSyncConfigured } from './sync/supabase';
import { useStore } from './store/store';

const SYNC_INTERVAL_MS = 30_000;
const BUSY_INTERVAL_MS = 8_000;
const REPORT_INTERVAL_MS = 5_000;

let busyInterval: number | null = null;

function reportState(): void {
  const sync = useSyncStore.getState();
  const app = useStore.getState();
  void fetch('/api/background-worker', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'report',
      role: 'background',
      syncConfigured: isSyncConfigured(),
      profileId: sync.profileId,
      profileName: sync.profileName,
      sessionExpired: sync.sessionExpired,
      extractionMode: app.extractionMode,
      cliBridge: app.cliBridge,
    }),
  }).catch(() => undefined);
}

function tick(): void {
  const { profileId, sessionExpired } = useSyncStore.getState();
  if (!isSyncConfigured() || !profileId || sessionExpired) {
    reportState();
    return;
  }
  void runSyncTick();
  void runProfileSyncTick();
  reportState();
}

/** Démarre uniquement les boucles utiles au traitement distant, sans monter l'interface complète. */
export async function startBackgroundWorker(): Promise<void> {
  // Ce profil Chrome isolé ne sert qu'au worker : choisis Codex automatiquement
  // avant le premier tick, sans afficher puis refermer une fenêtre de réglages.
  const app = useStore.getState();
  if (app.extractionMode !== 'claudecode') app.setExtractionMode('claudecode');
  if (app.cliBridge !== 'codex') app.setCliBridge('codex');
  initChangeTracker();
  await restoreSession();
  tick();
  window.setInterval(tick, SYNC_INTERVAL_MS);
  window.setInterval(reportState, REPORT_INTERVAL_MS);

  const syncBusy = () => {
    const { profileId, sessionExpired } = useSyncStore.getState();
    return Boolean(isSyncConfigured() && profileId && !sessionExpired && pendingTotal(useQueueStatus.getState().pending) > 0);
  };
  const refreshBusyLoop = () => {
    if (syncBusy() && busyInterval === null) {
      busyInterval = window.setInterval(() => {
        if (syncBusy()) void runSyncTick();
      }, BUSY_INTERVAL_MS);
    } else if (!syncBusy() && busyInterval !== null) {
      window.clearInterval(busyInterval);
      busyInterval = null;
    }
  };

  useQueueStatus.subscribe(refreshBusyLoop);
  useSyncStore.subscribe(refreshBusyLoop);
}
