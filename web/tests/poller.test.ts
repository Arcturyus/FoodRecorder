import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from '../src/store/store';

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
  results: [] as { id: string; kind: string; payload: unknown; created_at: string }[],
};
const pushed = {
  entries: [] as unknown[],
  sunEntries: [] as unknown[],
  weightEntries: [] as unknown[],
  processed: [] as string[],
};

vi.mock('../src/sync/supabase', () => ({
  isSyncConfigured: () => true,
  fetchPendingTranscripts: async () => rows.transcripts,
  fetchPendingImages: async () => rows.images,
  fetchPendingSun: async () => rows.sun,
  fetchPendingWeight: async () => rows.weight,
  fetchNewEntries: async () => rows.results,
  markProcessed: async (id: string) => void pushed.processed.push(id),
  pushEntry: async (_d: string, e: unknown) => void pushed.entries.push(e),
  pushSunEntry: async (_d: string, e: unknown) => void pushed.sunEntries.push(e),
  pushWeightEntry: async (_d: string, e: unknown) => void pushed.weightEntries.push(e),
  RESULT_KINDS: ['entry', 'sun-entry', 'weight-entry'],
}));

vi.mock('../src/extraction/claudeCode', () => ({
  checkClaudeCode: async () => ({ available: true }),
  extractWithClaudeCode: async (t: string) => ({
    items: [{ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }],
    source: 'claudecode',
    transcript: t,
  }),
  extractImageWithClaudeCode: async () => ({
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
  rows.results = [];
  pushed.entries = [];
  pushed.sunEntries = [];
  pushed.weightEntries = [];
  pushed.processed = [];
  useStore.setState({
    entries: [],
    sunExposures: [],
    weightEntries: [],
    extractionMode: 'claudecode',
    syncCursor: null,
  });
});

describe('runSyncTick — dictées soleil en attente', () => {
  it('analyse une dictée soleil, enregistre chaque sortie et redépose le résultat', async () => {
    rows.sun = [{ id: 'r1', payload: { transcript: 'vingt minutes ce matin puis une demi-heure à 17h' } }];

    await runSyncTick();

    const exposures = useStore.getState().sunExposures;
    expect(exposures).toHaveLength(2);
    // Champs dits par la dictée…
    expect(exposures.map((e) => e.heure).sort()).toEqual(['08:00', '17:00']);
    // …et champs non dits complétés par le repli (le poste n'a pas de formulaire).
    expect(exposures.every((e) => e.ciel === 'ensoleille' && e.phenotype === 'blanc')).toBe(true);
    expect(exposures.every((e) => e.date && e.id && e.createdAt)).toBe(true);

    // Redéposé pour les autres appareils, et la ligne est marquée traitée.
    expect(pushed.sunEntries).toHaveLength(1);
    expect((pushed.sunEntries[0] as { sorties: unknown[] }).sorties).toHaveLength(2);
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
  it('analyse une dictée de pesée, l’enregistre et redépose le résultat', async () => {
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

    expect(pushed.weightEntries).toHaveLength(1);
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

describe('runSyncTick — résultats reçus des autres appareils', () => {
  it('rejoue repas et sorties au soleil, et avance le curseur partagé', async () => {
    rows.results = [
      {
        id: 'a',
        kind: 'entry',
        created_at: '2026-07-17T10:00:00Z',
        payload: { transcript: 'une banane', items: [{ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }], source: 'claudecode' },
      },
      {
        id: 'b',
        kind: 'sun-entry',
        created_at: '2026-07-17T11:00:00Z',
        payload: {
          transcript: 'une demi-heure au soleil',
          sorties: [{ date: '2026-07-17', heure: '13:00', dureeMin: 30, ciel: 'ensoleille', peau: 'visage-bras', phenotype: 'blanc', creme: 'aucune' }],
        },
      },
      {
        id: 'c',
        kind: 'weight-entry',
        created_at: '2026-07-17T12:00:00Z',
        payload: {
          transcript: '68,5 kg à jeun',
          pesee: { date: '2026-07-17', heure: '08:00', aJeun: true, nu: true, poids: 68.5, source: 'claudecode' },
        },
      },
    ];

    await runSyncTick();

    expect(useStore.getState().entries).toHaveLength(1);
    expect(useStore.getState().sunExposures).toHaveLength(1);
    expect(useStore.getState().sunExposures[0].dureeMin).toBe(30);
    expect(useStore.getState().weightEntries).toHaveLength(1);
    expect(useStore.getState().weightEntries[0].poids).toBe(68.5);
    // Curseur = la ligne la plus récente, tous kinds confondus.
    expect(useStore.getState().syncCursor).toBe('2026-07-17T12:00:00Z');
  });

  it('n’explose pas si Supabase est injoignable (réseau coupé)', async () => {
    const mod = await import('../src/sync/supabase');
    vi.spyOn(mod, 'fetchNewEntries').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(runSyncTick()).resolves.toBeUndefined();
  });
});
