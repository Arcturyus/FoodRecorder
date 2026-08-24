import { useState } from 'react';
import { isSyncConfigured } from '../sync/supabase';
import { useSyncStore } from '../sync/syncStore';
import {
  createAndPushProfile,
  getJoinPreview,
  joinProfile,
  renameCurrentProfile,
  leaveProfile,
  reauthenticate,
  cancelJoin,
  runProfileSyncTick,
  type JoinPreview,
  type JoinStrategy,
} from '../sync/profileSync';

/** Formatage relatif court d'une date de dernière sync (« il y a 3 min »). */
function relativeTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/** Les 3 stratégies de jonction, expliquées, dans l'ordre recommandé. */
const JOIN_STRATEGIES: { id: JoinStrategy; label: string; desc: string }[] = [
  {
    id: 'pull',
    label: '⬇ Télécharger le profil (recommandé)',
    desc: 'Remplace les données de CE navigateur par celles du profil. À choisir si ce navigateur a des données incomplètes ou de test.',
  },
  {
    id: 'push',
    label: '⬆ Envoyer mes données locales',
    desc: 'Écrase le profil cloud avec les données de ce navigateur. À choisir si ce navigateur est la vraie référence.',
  },
  {
    id: 'merge',
    label: '⇄ Fusionner',
    desc: 'Garde les deux côtés (en cas de conflit sur une même donnée, le cloud gagne). À éviter si ce navigateur a des données douteuses.',
  },
];

/**
 * Sauvegarde/synchronisation par PROFIL : on se connecte par un nom + mot de passe
 * (renommable, id stable côté Supabase) et on retrouve ses données sur n'importe
 * quel navigateur. Le mot de passe est vérifié côté serveur (Edge Function) et donne
 * un jeton de session — sans lui, les données du profil restent inaccessibles.
 * Masqué si Supabase n'est pas configuré.
 */
export function ProfileSyncPanel() {
  const profileId = useSyncStore((s) => s.profileId);
  const profileName = useSyncStore((s) => s.profileName);
  const sessionExpired = useSyncStore((s) => s.sessionExpired);
  const pendingCount = useSyncStore((s) => Object.keys(s.pending).length);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const lastError = useSyncStore((s) => s.lastError);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState<JoinPreview | null>(null);

  if (!isSyncConfigured()) return null;

  async function run(action: () => Promise<void>, okMessage: string) {
    setBusy(true);
    setStatus('');
    try {
      await action();
      setStatus(okMessage);
    } catch (e) {
      setStatus(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const n = name.trim();
    if (!n || !password) return;
    await run(() => createAndPushProfile(n, password), `Profil « ${n} » créé et données envoyées.`);
    setName('');
    setPassword('');
  }

  async function handleLookup() {
    const n = name.trim();
    if (!n || !password) return;
    setBusy(true);
    setStatus('');
    try {
      setPreview(await getJoinPreview(n, password));
    } catch (e) {
      setStatus(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin(strategy: JoinStrategy) {
    if (!preview) return;
    const target = preview;
    setPreview(null);
    await run(
      () => joinProfile(target, strategy),
      `Connecté au profil « ${target.profile.name} ». Une sauvegarde JSON de sécurité a été téléchargée.`,
    );
    setName('');
    setPassword('');
  }

  /**
   * Renonce à la jonction en cours. `getJoinPreview` s'est déjà connecté pour pouvoir compter les
   * repas du profil : sans cette fermeture, le client Supabase resterait connecté à un profil que
   * le store, lui, n'a pas rejoint.
   */
  function handleCancelJoin() {
    setPreview(null);
    cancelJoin();
  }

  async function handleRename() {
    const next = window.prompt('Nouveau nom du profil :', profileName ?? '');
    if (!next || !next.trim()) return;
    await run(() => renameCurrentProfile(next), `Profil renommé en « ${next.trim() }».`);
  }

  async function handleLeave() {
    if (!window.confirm('Se déconnecter du profil ? Les données de ce navigateur restent en place, mais ne seront plus synchronisées.')) return;
    await run(() => leaveProfile(), 'Déconnecté du profil.');
  }

  async function handleReauthenticate() {
    if (!password) return;
    await run(() => reauthenticate(password), `Reconnecté au profil « ${profileName} ».`);
    setPassword('');
  }

  if (sessionExpired) {
    return (
      <div className="panel">
        <h2>Compte &amp; synchronisation cloud</h2>
        <p className="small" style={{ marginTop: -6, color: 'var(--warn)' }}>
          Session expirée pour le profil <strong>{profileName}</strong>. Ressaisissez le mot de passe pour reprendre
          la synchronisation (les données déjà sur ce navigateur restent intactes).
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe"
            style={{ flex: '1 1 200px' }}
            disabled={busy}
            autoFocus
          />
          <button className="primary" disabled={busy || !password} onClick={handleReauthenticate}>
            Se reconnecter
          </button>
          <button className="ghost" disabled={busy} onClick={handleLeave}>Oublier ce profil</button>
        </div>
        {status && <div className="status">{status}</div>}
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>Compte &amp; synchronisation cloud</h2>

      {profileId ? (
        <>
          <p className="small" style={{ marginTop: -6 }}>
            Connecté au profil <strong>{profileName}</strong>. Vos données sont sauvegardées et synchronisées entre vos
            navigateurs.
          </p>
          <div className="hint">
            {lastSyncAt ? `Dernière synchro ${relativeTime(lastSyncAt)}` : 'Pas encore synchronisé'}
            {pendingCount > 0 ? ` · ${pendingCount} modification(s) en attente d'envoi` : ' · à jour'}
            {lastError && <span style={{ color: 'var(--warn)' }}> · ⚠️ {lastError}</span>}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="primary" disabled={busy} onClick={() => run(() => runProfileSyncTick(), 'Synchronisation effectuée.')}>
              🔄 Synchroniser maintenant
            </button>
            <button disabled={busy} onClick={handleRename}>✎ Renommer</button>
            <button className="ghost" disabled={busy} onClick={handleLeave}>Se déconnecter</button>
          </div>
        </>
      ) : (
        <>
          <p className="small" style={{ marginTop: -6 }}>
            Entrez un nom et un mot de passe (6 caractères minimum) pour retrouver vos données depuis
            n'importe quel navigateur. <strong>Rejoindre</strong> si le profil a déjà un mot de passe,
            <strong> Créer</strong> sinon — y compris pour un profil existant qui n'en a pas encore, que
            « Créer » adopte avec le mot de passe saisi. Il protège seul l'accès à vos données :
            <strong> retenez-le, il n'y a aucune récupération possible</strong>.
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom du profil"
              style={{ flex: '1 1 160px' }}
              disabled={busy}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mot de passe"
              style={{ flex: '1 1 160px' }}
              disabled={busy}
            />
            <button className="primary" disabled={busy || !name.trim() || !password} onClick={handleCreate}>
              Créer ce profil
            </button>
            <button disabled={busy || !name.trim() || !password} onClick={handleLookup}>
              Rejoindre…
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--accent)', borderRadius: 10 }}>
              <div className="small" style={{ marginBottom: 8 }}>
                Profil « <strong>{preview.profile.name}</strong> » trouvé — ce navigateur : <strong>{preview.localEntries}</strong>{' '}
                repas · profil cloud : <strong>{preview.cloudEntries}</strong> repas. Comment le rejoindre ?
                <br />
                <span style={{ color: 'var(--warn)' }}>
                  Une sauvegarde JSON de ce navigateur sera téléchargée automatiquement avant toute action.
                </span>
              </div>
              <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                {JOIN_STRATEGIES.map((st) => (
                  <button
                    key={st.id}
                    disabled={busy}
                    onClick={() => handleJoin(st.id)}
                    style={{ textAlign: 'left', padding: '10px 12px', height: 'auto' }}
                  >
                    <strong>{st.label}</strong>
                    <span className="small"> — {st.desc}</span>
                  </button>
                ))}
                <button className="ghost small" disabled={busy} onClick={handleCancelJoin}>
                  Annuler
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {status && <div className="status">{status}</div>}
    </div>
  );
}
