import { useCallback, useEffect, useState } from 'react';

interface BackgroundWorkerStatus {
  enabled: boolean;
  running: boolean;
  mode: 'headless' | 'setup' | null;
  configured: boolean;
  syncConfigured: boolean | null;
  connected: boolean;
  sessionExpired: boolean;
  profileName: string | null;
  lastSeenAt: number | null;
  error: string | null;
}

async function requestWorker(action?: string, enabled?: boolean): Promise<BackgroundWorkerStatus> {
  const response = action
    ? await fetch('/api/background-worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(enabled === undefined ? {} : { enabled }) }),
      })
    : await fetch('/api/background-worker', { cache: 'no-store' });
  const payload = (await response.json()) as BackgroundWorkerStatus & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Pont local indisponible (${response.status}).`);
  return payload;
}

/** Commande locale à cet ordinateur : elle ne touche pas aux réglages synchronisés du profil. */
export function BackgroundWorkerSettings() {
  const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<BackgroundWorkerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!isLocal) return;
    try {
      const next = await requestWorker();
      setStatus(next);
      setAvailable(true);
    } catch {
      setAvailable(false);
    }
  }, [isLocal]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  async function act(action: string, enabled?: boolean) {
    setBusy(true);
    setMessage('');
    try {
      const next = await requestWorker(action, enabled);
      setStatus(next);
      setAvailable(true);
      setMessage(action === 'setup' ? 'La fenêtre de configuration s’ouvre.' : 'Réglage appliqué sur cet ordinateur.');
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!isLocal || !available || !status) return null;

  const seenRecently = status.lastSeenAt !== null && Date.now() - status.lastSeenAt < 20_000;
  let summary = 'En pause sur cet ordinateur.';
  if (status.mode === 'setup') summary = 'Fenêtre de configuration ouverte : connecte le profil et choisis Codex CLI.';
  else if (status.mode === 'headless' && status.sessionExpired) summary = 'Session expirée : une fenêtre visible s’ouvre pour te reconnecter.';
  else if (status.mode === 'headless' && status.connected && seenRecently) summary = 'Actif en arrière-plan avec Codex CLI.';
  else if (status.mode === 'headless') summary = 'Chrome headless démarre ou attend son premier état.';
  else if (status.enabled && !status.configured) summary = 'Activation enregistrée : configure le profil dans la fenêtre qui s’ouvre.';
  else if (status.enabled && status.configured) summary = 'Activé ; le worker démarrera au prochain lancement du serveur local.';

  return (
    <section className="panel" data-agent-section="analyse-arriere-plan">
      <h2>Analyse automatique sur cet ordinateur</h2>
      <p className="small" style={{ marginTop: -6 }}>
        Le PC analyse les dictées et photos déposées depuis le téléphone. Chrome fonctionne sans fenêtre tant que ta
        session Windows est ouverte. Ce réglage reste local à cet ordinateur.
      </p>
      <div className="small" role="status">{summary}</div>
      {status.syncConfigured === false && (
        <div className="small" style={{ color: 'var(--danger)' }}>
          La synchronisation Supabase n’est pas configurée sur cette installation locale.
        </div>
      )}
      {status.profileName && <div className="small">Profil utilisé : {status.profileName}</div>}
      {status.error && <div className="small" style={{ color: 'var(--danger)' }}>{status.error}</div>}
      <div className="row wrap-form" style={{ marginTop: 10 }}>
        <button type="button" onClick={() => void act('setup')} disabled={busy}>
          Configurer / reconnecter le profil de fond
        </button>
        <label className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={status.enabled}
            disabled={busy}
            onChange={(event) => void act('enabled', event.currentTarget.checked)}
            style={{ width: 'auto' }}
          />
          Activer l’analyse automatique ici
        </label>
      </div>
      <p className="small" style={{ marginBottom: 0 }}>
        À la première configuration, une fenêtre visible te demandera de rejoindre ton profil FoodRecorder. La session
        reste mémorisée dans le profil Chrome dédié et se renouvelle automatiquement ; le mot de passe n’est pas stocké.
        Le worker sélectionne lui-même « Pont CLI → Codex ». Si la session expire ou est révoquée, la fenêtre réapparaît
        pour une reconnexion manuelle.
      </p>
      <p className="small" style={{ marginBottom: 0 }}>
        Pour lancer le serveur automatiquement à ta connexion Windows : <code>npm run worker:install</code> depuis
        le dossier <code>web</code>. Pour le retirer : <code>npm run worker:uninstall</code>.
      </p>
      {message && <div className="small" role="status" style={{ marginTop: 8 }}>{message}</div>}
    </section>
  );
}
