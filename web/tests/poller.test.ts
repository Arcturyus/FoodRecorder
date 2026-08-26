import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from '../src/store/store';
import { useSyncStore } from '../src/sync/syncStore';
import { useQueueStatus, NO_PENDING } from '../src/sync/queueStatus';

/**
 * Le poller parle à Supabase et au pont Claude Code : les deux sont simulés.
 * On vérifie le routage (quel kind est traité par quoi, ce qui est redéposé,
 * ce qui atterrit dans le journal), pas les appels réseau eux-mêmes.
 */

const rows = {
  transcripts: [] as { id: string; payload: { transcript: string; date?: string } }[],
  images: [] as { id: string; payload: { imageBase64: string; mediaType: string; date?: string } }[],
  sun: [] as { id: string; payload: { transcript: string; date?: string } }[],
  weight: [] as { id: string; payload: { transcript: string; date?: string; clientTime?: number } }[],
};
const pushed = {
  processed: [] as string[],
};

vi.mock('../src/sync/supabase', () => ({
  isSyncConfigured: () => true,
  fetchPendingTranscripts: async () => rows.transcripts,
  fetchPendingImages: async () => rows.images,
  fetchPendingSun: async () => rows.sun,
  fetchPendingWeight: async () => rows.weight,
  summarizePending: async () => ({
    counts: {
      transcript: rows.transcripts.length,
      image: rows.images.length,
      sun: rows.sun.length,
      weight: rows.weight.length,
    },
    items: [],
  }),
  pendingItemOf: (row: { id: string; kind?: string; payload: { transcript?: string; date?: string } }) => ({
    id: row.id,
    kind: row.kind ?? 'transcript',
    transcript: row.payload.transcript,
    date: row.payload.date,
    sentAt: 0,
  }),
  markProcessed: async (id: string) => void pushed.processed.push(id),
  markImageProcessed: async (id: string) => void pushed.processed.push(id),
}));

vi.mock('../src/extraction/bridge', () => ({
  checkBridge: async () => ({ available: true }),
  callBridge: async () => '',
  currentCli: () => 'claude',
  currentCliLabel: () => 'Claude Code',
  CLI_LABELS: { claude: 'Claude Code', codex: 'Codex' },
}));

vi.mock('../src/extraction/cliExtract', () => ({
  extractWithCli: async (t: string) => ({
    items: [{ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }],
    source: 'claudecode',
    transcript: t,
  }),
  extractImageWithCli: async () => ({
    items: [{ aliment: 'pizza', quantite: 1, unite: 'portion', estimation: true }],
    source: 'claudecode',
  }),
}));

vi.mock('../src/extraction/sun', () => ({
  extractSun: async () => ({
    sorties: [
      { heure: '08:00', dureeMin: 20, peau: 'visage-bras' },
      { heure: '17:00', dureeMin: 30 },
    ],
    source: 'claudecode',
  }),
}));

// Seule l'extraction est simulée : `completeWeightEntry` (pure) reste la vraie,
// c'est elle qui décide des valeurs de repli du traitement différé.
vi.mock('../src/extraction/weight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/extraction/weight')>()),
  extractWeight: async () => ({ patch: { poids: 68.5, masseGrasse: 18.2 }, source: 'claudecode' }),
}));

const { runSyncTick } = await import('../src/sync/poller');

beforeEach(() => {
  rows.transcripts = [];
  rows.images = [];
  rows.sun = [];
  rows.weight = [];
  pushed.processed = [];
  useStore.setState({
    entries: [],
    sunExposures: [],
    weightEntries: [],
    extractionMode: 'claudecode',
    syncCursor: null,
  });
  // runSyncTick exige désormais une session de profil active (cf. sync_queue cloisonnée par profil).
  useSyncStore.setState({ profileId: 'p1', profileName: 'p1', sessionExpired: false });
  useQueueStatus.setState({ pending: NO_PENDING, current: null, hasBridge: false, done: 0, failures: [] });
});

describe('runSyncTick — dictées soleil en attente', () => {
  it('analyse une dictée soleil et enregistre chaque sortie dans le journal local', async () => {
    rows.sun = [{ id: 'r1', payload: { transcript: 'vingt minutes ce matin puis une demi-heure à 17h' } }];

    await runSyncTick();

    const exposures = useStore.getState().sunExposures;
    expect(exposures).toHaveLength(2);
    // Champs dits par la dictée…
    expect(exposures.map((e) => e.heure).sort()).toEqual(['08:00', '17:00']);
    // …et champs non dits complétés par le repli (le poste n'a pas de formulaire).
    expect(exposures.every((e) => e.ciel === 'ensoleille' && e.phenotype === 'blanc')).toBe(true);
    expect(exposures.every((e) => e.date && e.id && e.createdAt)).toBe(true);

    // La ligne est marquée traitée ; la diffusion vers les autres appareils passe désormais par
    // la synchro d'état (profileSync), plus par un « résultat » redéposé dans la file.
    expect(pushed.processed).toContain('r1');
  });

  it('respecte le jour ciblé par l’appareil émetteur', async () => {
    rows.sun = [{ id: 'r1', payload: { transcript: 'hier', date: '2026-07-01' } }];
    await runSyncTick();
    expect(useStore.getState().sunExposures.every((e) => e.date === '2026-07-01')).toBe(true);
  });

  it('ne traite pas les dictées soleil hors mode « pont Claude Code »', async () => {
    useStore.setState({ extractionMode: 'rules' });
    rows.sun = [{ id: 'r1', payload: { transcript: 'vingt minutes au soleil' } }];
    await runSyncTick();
    expect(useStore.getState().sunExposures).toHaveLength(0);
    expect(pushed.processed).toHaveLength(0);
  });
});

describe('runSyncTick — dictées de pesée en attente', () => {
  it('analyse une dictée de pesée et l’enregistre dans le journal local', async () => {
    rows.weight = [{ id: 'w1', payload: { transcript: 'soixante-huit cinq, masse grasse 18,2', date: '2026-07-02', clientTime: 1_770_000_000_000 } }];

    await runSyncTick();

    const pesees = useStore.getState().weightEntries;
    expect(pesees).toHaveLength(1);
    expect(pesees[0].poids).toBe(68.5);
    // Jour ciblé par l'émetteur, pas le jour du traitement différé.
    expect(pesees[0].date).toBe('2026-07-02');
    // Champs non dits : valeurs de repli du formulaire (le poste n'en a pas).
    expect(pesees[0].aJeun).toBe(true);
    expect(pesees[0].nu).toBe(true);
    expect(pesees[0].source).toBe('claudecode');
    // Heure de saisie de l'émetteur, pas l'heure de ce traitement.
    expect(pesees[0].createdAt).toBe(1_770_000_000_000);

    expect(pushed.processed).toContain('w1');
  });

  it('ne traite pas les dictées de pesée hors mode « pont Claude Code »', async () => {
    useStore.setState({ extractionMode: 'rules' });
    rows.weight = [{ id: 'w1', payload: { transcript: '68,5 kg' } }];
    await runSyncTick();
    expect(useStore.getState().weightEntries).toHaveLength(0);
    expect(pushed.processed).toHaveLength(0);
  });
});

describe('runSyncTick — état publié pour le bandeau', () => {
  it('vide la file et laisse un bilan « tout traité »', async () => {
    rows.transcripts = [{ id: 't1', payload: { transcript: 'une banane' } }];
    rows.images = [{ id: 'i1', payload: { imageBase64: 'AAAA', mediaType: 'image/jpeg' } }];

    await runSyncTick();

    const q = useQueueStatus.getState();
    expect(q.hasBridge).toBe(true);
    expect(q.done).toBe(2);
    expect(q.failures).toEqual([]);
    // Plus rien en attente ni en cours : le bandeau passe à « Tout est traité ».
    expect(q.pending).toEqual(NO_PENDING);
    expect(q.current).toBeNull();
  });

  it('compte à part une ligne traitée sans résultat, avec son motif', async () => {
    const cli = await import('../src/extraction/cliExtract');
    vi.spyOn(cli, 'extractWithCli').mockResolvedValueOnce({ items: [], source: 'claudecode' });
    rows.transcripts = [{ id: 't1', payload: { transcript: 'euh…' } }];

    await runSyncTick();

    const q = useQueueStatus.getState();
    expect(q.done).toBe(0);
    expect(q.failures).toEqual([{ kind: 'transcript', message: 'Aucun aliment reconnu dans la dictée.' }]);
    // La ligne quitte quand même la file : sans ça le pont y reviendrait à chaque tick.
    expect(pushed.processed).toContain('t1');
  });

  it('sans pont, se contente de compter ce qui attend (cas du téléphone)', async () => {
    useStore.setState({ extractionMode: 'rules' });
    rows.images = [
      { id: 'i1', payload: { imageBase64: 'AAAA', mediaType: 'image/jpeg' } },
      { id: 'i2', payload: { imageBase64: 'BBBB', mediaType: 'image/jpeg' } },
    ];

    await runSyncTick();

    const q = useQueueStatus.getState();
    expect(q.hasBridge).toBe(false);
    expect(q.pending.image).toBe(2);
    // Il n'analyse rien : ni entrée créée, ni ligne consommée.
    expect(q.current).toBeNull();
    expect(useStore.getState().entries).toHaveLength(0);
    expect(pushed.processed).toHaveLength(0);
  });
});

describe('runSyncTick — garde-fous', () => {
  it('ne fait rien sans session de profil active (sync_queue exige désormais une authentification)', async () => {
    useSyncStore.setState({ profileId: null });
    rows.sun = [{ id: 'r1', payload: { transcript: 'vingt minutes au soleil' } }];
    await runSyncTick();
    expect(useStore.getState().sunExposures).toHaveLength(0);
    expect(pushed.processed).toHaveLength(0);
  });

  it('ne fait rien si la session a expiré', async () => {
    useSyncStore.setState({ sessionExpired: true });
    rows.sun = [{ id: 'r1', payload: { transcript: 'vingt minutes au soleil' } }];
    await runSyncTick();
    expect(useStore.getState().sunExposures).toHaveLength(0);
  });

  it('n’explose pas si Supabase est injoignable (réseau coupé)', async () => {
    const mod = await import('../src/sync/supabase');
    vi.spyOn(mod, 'fetchPendingTranscripts').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(runSyncTick()).resolves.toBeUndefined();
  });
});
