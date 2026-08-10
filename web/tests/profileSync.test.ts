import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useStore } from '../src/store/store';
import { useSyncStore } from '../src/sync/syncStore';
import { initChangeTracker } from '../src/sync/changeTracker';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import { DEFAULT_PROFILE } from '../src/nutrition/targets';
import { DEFAULT_WEIGHT_CONFIG } from '../src/weight/types';

/**
 * Le moteur de sync parle à Supabase (mocké) : on vérifie le pull/push, l'arbitrage
 * last-write-wins, les tombstones, l'anti-boucle, le recalcul des nutriments, les
 * jonctions (mot de passe → jeton) et la détection d'expiration de session — pas
 * les appels réseau eux-mêmes.
 */

// Supabase « configuré » (sinon le tick est un no-op) ; la vraie clé est absente en test.
vi.mock('../src/sync/supabase', () => ({ isSyncConfigured: () => true, supabase: null, setSessionToken: () => {} }));
// exportJsonFile touche au DOM (indispo en env node) : neutralisé.
vi.mock('../src/store/backup', () => ({ exportJsonFile: () => {} }));

const db = vi.hoisted(() => ({
  profiles: [] as { id: string; name: string }[],
  rows: {} as Record<string, any[]>,
  counter: 0,
  /** `network` = panne passagère, `auth` = jeton refusé (code PostgREST PGRST301). */
  failUpsert: null as null | 'network' | 'auth',
}));

/** Session Supabase simulée : c'est supabase-js qui la porte en vrai, on n'observe que l'état. */
const session = vi.hoisted(() => ({ open: false }));

vi.mock('../src/sync/profileApi', () => ({
  // Reproduit le vrai `isAuthError` : c'est le CODE qui décide, pas le message.
  isAuthError: (e: unknown) => (e as { code?: string } | null)?.code === 'PGRST301',
  loginProfile: async (name: string) => {
    const p = db.profiles.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
    if (!p) throw new Error('Nom ou mot de passe incorrect.');
    session.open = true;
    return { id: p.id, name: p.name };
  },
  signupProfile: async (name: string) => {
    const trimmed = name.trim();
    if (db.profiles.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new Error('Ce nom de profil est déjà utilisé. Utilisez « Rejoindre » pour vous y connecter.');
    }
    const p = { id: `pid-${trimmed}`, name: trimmed };
    db.profiles.push(p);
    session.open = true;
    return { id: p.id, name: p.name };
  },
  signOut: async () => {
    session.open = false;
  },
  hasValidSession: async () => session.open,
  renameProfile: async () => {},
  fetchRowsSince: async (table: string, profileId: string, cursor: string | null, device: string) =>
    (db.rows[table] ?? []).filter((r) => r.profile_id === profileId && r.device !== device && (!cursor || (r.synced_at ?? '') > cursor)),
  fetchAllRows: async (table: string, profileId: string) =>
    (db.rows[table] ?? []).filter((r) => r.profile_id === profileId && !r.deleted),
  countRows: async (table: string, profileId: string) =>
    (db.rows[table] ?? []).filter((r) => r.profile_id === profileId && !r.deleted).length,
  upsertRows: async (table: string, rows: any[]) => {
    if (db.failUpsert === 'auth') {
      const e = new Error('JWT expired') as Error & { code?: string };
      e.code = 'PGRST301';
      throw e;
    }
    if (db.failUpsert === 'network') throw new Error('boom réseau');
    const list = (db.rows[table] ??= []);
    const kf = table === 'profile_kv' ? 'key' : 'id';
    for (const row of rows) {
      db.counter += 1;
      const stored = { ...row, synced_at: String(db.counter).padStart(6, '0') };
      const idx = list.findIndex((r) => r.profile_id === row.profile_id && r[kf] === row[kf]);
      if (idx >= 0) list[idx] = stored;
      else list.push(stored);
    }
  },
}));

const { runProfileSyncTick, joinProfile, createAndPushProfile, getJoinPreview, reauthenticate, leaveProfile } =
  await import('../src/sync/profileSync');

initChangeTracker();

/** Fabrique une ligne cloud d'entrée journal (device « other » par défaut = venue d'ailleurs). */
function entryRow(id: string, over: Record<string, unknown> = {}) {
  return {
    profile_id: 'p1',
    id,
    payload: { id, date: '2026-07-19', createdAt: 1, transcript: id, source: 'manuel', items: [] },
    updated_at: 100,
    deleted: false,
    device: 'other',
    synced_at: '000100',
    ...over,
  };
}

/** Configure l'état local SANS profil actif (pour ne rien marquer dirty), puis joint « p1 ». */
function localEntries(entries: any[]) {
  useStore.setState({ entries });
}

beforeEach(() => {
  db.profiles = [];
  db.rows = {};
  db.counter = 0;
  db.failUpsert = null;
  session.open = false;
  useSyncStore.setState({
    profileId: null,
    profileName: null,
    sessionExpired: false,
    pending: {},
    pullCursor: null,
    lastSyncAt: null,
    lastError: null,
  });
  useStore.setState({
    entries: [],
    customFoods: [],
    foodOverrides: {},
    favoriteMeals: [],
    weightEntries: [],
    sunExposures: [],
    profile: DEFAULT_PROFILE,
    weightConfig: DEFAULT_WEIGHT_CONFIG,
    deviceId: 'me',
  });
});

/** Joint le profil p1 (après avoir configuré le local), sans passer par le réseau. */
function join(cursor: string | null = null) {
  session.open = true;
  useSyncStore.setState({ profileId: 'p1', profileName: 'p1', sessionExpired: false, pending: {}, pullCursor: cursor });
}

describe('runProfileSyncTick — pull', () => {
  it('applique une entrée distante absente en local (LWW)', async () => {
    db.rows.journal_entries = [entryRow('e1')];
    join();
    await runProfileSyncTick();
    expect(useStore.getState().entries.map((e) => e.id)).toContain('e1');
    expect(useSyncStore.getState().pullCursor).toBe('000100');
  });

  it('ignore une ligne distante plus ancienne qu’une modification locale en attente', async () => {
    localEntries([{ id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'LOCAL', source: 'manuel', items: [] }]);
    db.rows.journal_entries = [entryRow('e1', { updated_at: 100, payload: { id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'DISTANT', source: 'manuel', items: [] } })];
    join();
    useSyncStore.setState({ pending: { 'journal_entries:e1': { updatedAt: 200 } } });
    await runProfileSyncTick();
    expect(useStore.getState().entries[0].transcript).toBe('LOCAL');
  });

  it('retire une entrée sur tombstone distant, sans re-marquer dirty', async () => {
    localEntries([{ id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'x', source: 'manuel', items: [] }]);
    db.rows.journal_entries = [entryRow('e1', { deleted: true, updated_at: 200, synced_at: '000200' })];
    join();
    await runProfileSyncTick();
    expect(useStore.getState().entries).toHaveLength(0);
    expect(Object.keys(useSyncStore.getState().pending)).toHaveLength(0);
  });

  it('un pull ne crée aucune modification en attente (anti-boucle)', async () => {
    db.rows.journal_entries = [entryRow('e1')];
    join();
    await runProfileSyncTick();
    expect(Object.keys(useSyncStore.getState().pending)).toHaveLength(0);
  });

  it('recalcule les nutriments périmés d’un payload distant depuis la banque', async () => {
    db.rows.journal_entries = [
      entryRow('e1', {
        payload: {
          id: 'e1',
          date: '2026-07-19',
          createdAt: 1,
          transcript: 'banane',
          source: 'manuel',
          items: [{ id: 'i1', foodId: 'banane', nomAffiche: 'Banane', quantite: 100, unite: 'g', grams: 100, nutrients: { ...EMPTY_NUTRIENTS, kcal: 0 }, estimation: false, douteux: false }],
        },
      }),
    ];
    join();
    await runProfileSyncTick();
    expect(useStore.getState().entries[0].items[0].nutrients.kcal).toBe(90); // banane = 90 kcal / 100 g
  });
});

describe('runProfileSyncTick — push', () => {
  it('envoie le payload courant + les tombstones, puis vide le pending sur succès', async () => {
    localEntries([{ id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'hello', source: 'manuel', items: [] }]);
    join();
    useSyncStore.setState({ pending: { 'journal_entries:e1': { updatedAt: 100 }, 'journal_entries:e2': { updatedAt: 100, deleted: true } } });
    await runProfileSyncTick();

    const rows = db.rows.journal_entries ?? [];
    const e1 = rows.find((r) => r.id === 'e1');
    const e2 = rows.find((r) => r.id === 'e2');
    expect(e1.deleted).toBe(false);
    expect((e1.payload as any).transcript).toBe('hello');
    expect(e2.deleted).toBe(true);
    expect(Object.keys(useSyncStore.getState().pending)).toHaveLength(0);
  });

  it('conserve le pending et signale l’erreur si le push échoue (réseau)', async () => {
    localEntries([{ id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'hello', source: 'manuel', items: [] }]);
    join();
    useSyncStore.setState({ pending: { 'journal_entries:e1': { updatedAt: 100 } } });
    db.failUpsert = 'network';
    await runProfileSyncTick();
    expect(useSyncStore.getState().pending['journal_entries:e1']).toBeTruthy();
    expect(useSyncStore.getState().lastError).toBeTruthy();
    // Une panne réseau ne doit SURTOUT pas déconnecter : les données en attente seraient bloquées
    // derrière une demande de mot de passe alors que la session est parfaitement valide.
    expect(useSyncStore.getState().sessionExpired).toBe(false);
  });

  it('bascule sessionExpired quand PostgREST rejette la session (PGRST301)', async () => {
    localEntries([{ id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'hello', source: 'manuel', items: [] }]);
    join();
    useSyncStore.setState({ pending: { 'journal_entries:e1': { updatedAt: 100 } } });
    db.failUpsert = 'auth';
    await runProfileSyncTick();
    expect(useSyncStore.getState().sessionExpired).toBe(true);
    // Le nom du profil reste affiché pour proposer une reconnexion, pas un abandon complet.
    expect(useSyncStore.getState().profileId).toBe('p1');
    expect(useSyncStore.getState().profileName).toBe('p1');
    // Les modifications en attente survivent : elles repartiront après reconnexion.
    expect(useSyncStore.getState().pending['journal_entries:e1']).toBeTruthy();
  });

  it('un tick est un no-op tant que la session est expirée', async () => {
    localEntries([{ id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'hello', source: 'manuel', items: [] }]);
    join();
    useSyncStore.setState({ sessionExpired: true, pending: { 'journal_entries:e1': { updatedAt: 100 } } });
    await runProfileSyncTick();
    expect(db.rows.journal_entries ?? []).toHaveLength(0);
  });
});

describe('reconnexion après expiration', () => {
  it('rétablit la session SANS perdre les modifications faites pendant l’expiration', async () => {
    db.profiles = [{ id: 'p1', name: 'p1' }];
    localEntries([{ id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'hello', source: 'manuel', items: [] }]);
    join('000050');
    // Session expirée, puis une modification locale faite hors ligne.
    session.open = false;
    useSyncStore.setState({
      sessionExpired: true,
      pending: { 'journal_entries:e1': { updatedAt: 100 } },
    });

    await reauthenticate('secret');

    expect(useSyncStore.getState().sessionExpired).toBe(false);
    // La modification a bien été poussée, pas jetée avec la session.
    expect((db.rows.journal_entries ?? []).map((r) => r.id)).toEqual(['e1']);
  });

  it('refuse de reconnecter si le nom pointe désormais vers un autre profil', async () => {
    db.profiles = [{ id: 'autre', name: 'p1' }];
    join();
    session.open = false;
    useSyncStore.setState({ sessionExpired: true });
    await expect(reauthenticate('secret')).rejects.toThrow('un autre profil');
    // La session ouverte par la tentative est refermée : pas de session sur un profil étranger.
    expect(session.open).toBe(false);
  });

  it('leaveProfile efface l’état local ET ferme la session Supabase', async () => {
    join();
    await leaveProfile();
    const s = useSyncStore.getState();
    expect(s.profileId).toBeNull();
    expect(s.profileName).toBeNull();
    expect(s.sessionExpired).toBe(false);
    expect(session.open).toBe(false);
  });
});

describe('jonction et création', () => {
  it('getJoinPreview rejette si le nom/mot de passe ne correspond à aucun profil', async () => {
    await expect(getJoinPreview('inconnu', 'secret')).rejects.toThrow('Nom ou mot de passe incorrect.');
  });

  it('joinProfile "pull" remplace le local, vide le pending et pose le curseur', async () => {
    db.profiles = [{ id: 'p1', name: 'romain' }];
    db.rows.journal_entries = [entryRow('c1')];
    localEntries([{ id: 'junk', date: '2026-07-19', createdAt: 1, transcript: 'poubelle', source: 'manuel', items: [] }]);
    useSyncStore.setState({ pending: { 'journal_entries:junk': { updatedAt: 1 } } });

    const preview = await getJoinPreview('romain', 'secret');
    await joinProfile(preview, 'pull');

    expect(useStore.getState().entries.map((e) => e.id)).toEqual(['c1']);
    expect(useSyncStore.getState().profileId).toBe('p1');
    expect(Object.keys(useSyncStore.getState().pending)).toHaveLength(0);
    expect(useSyncStore.getState().pullCursor).toBe('000100');
  });

  it('createAndPushProfile crée le profil et pousse tout l’état local', async () => {
    localEntries([
      { id: 'e1', date: '2026-07-19', createdAt: 1, transcript: 'a', source: 'manuel', items: [] },
      { id: 'e2', date: '2026-07-19', createdAt: 2, transcript: 'b', source: 'manuel', items: [] },
    ]);

    await createAndPushProfile('nouveau', 'secret');

    expect(db.profiles.map((p) => p.name)).toContain('nouveau');
    const ids = (db.rows.journal_entries ?? []).map((r) => r.id).sort();
    expect(ids).toEqual(['e1', 'e2']);
    expect(useSyncStore.getState().profileId).toBe('pid-nouveau');
    expect(Object.keys(useSyncStore.getState().pending)).toHaveLength(0);
    // Les singletons sont aussi poussés.
    expect((db.rows.profile_kv ?? []).map((r) => r.key).sort()).toEqual([
      'dayNotes',
      'mutedDays',
      'nutrientImportance',
      'profile',
      'weightConfig',
    ]);
  });
});
