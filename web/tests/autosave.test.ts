import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runAutoSaveTick } from '../src/store/autosave';
import { useStore, todayStr } from '../src/store/store';

/** Simule le middleware de dev : GET = santé, POST = écriture. */
function mockEndpoint({ available = true, ok = true } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { method?: string }) => {
      const method = init?.method ?? 'GET';
      calls.push(method);
      if (method === 'GET') return { ok: available, json: async () => ({ available }) };
      return ok
        ? { ok: true, json: async () => ({ written: 'save/foodrecorder-test.json' }) }
        : { ok: false, json: async () => ({ error: 'disque plein' }) };
    }),
  );
  return calls;
}

beforeEach(() => {
  useStore.setState({ lastAutoSave: null, entries: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe('runAutoSaveTick', () => {
  it('écrit la sauvegarde à la première ouverture du jour et mémorise le jour', async () => {
    mockEndpoint();
    await expect(runAutoSaveTick()).resolves.toEqual({ status: 'written', file: 'save/foodrecorder-test.json' });
    expect(useStore.getState().lastAutoSave).toBe(todayStr());
  });

  it('n’écrit qu’une fois par jour', async () => {
    const calls = mockEndpoint();
    await runAutoSaveTick();
    const posts = calls.filter((c) => c === 'POST').length;
    await expect(runAutoSaveTick()).resolves.toEqual({ status: 'already-done' });
    expect(calls.filter((c) => c === 'POST')).toHaveLength(posts);
  });

  it('deux appels simultanés n’écrivent qu’une seule fois (StrictMode monte l’effet 2×)', async () => {
    const calls = mockEndpoint();
    await Promise.all([runAutoSaveTick(), runAutoSaveTick()]);
    expect(calls.filter((c) => c === 'POST')).toHaveLength(1);
  });

  it('endpoint absent (site déployé) → no-op, et on retentera demain', async () => {
    mockEndpoint({ available: false });
    await expect(runAutoSaveTick()).resolves.toEqual({ status: 'unavailable' });
    expect(useStore.getState().lastAutoSave).toBeNull();
  });

  it('écriture refusée → le jour n’est PAS marqué (nouvel essai à la prochaine ouverture)', async () => {
    mockEndpoint({ ok: false });
    await expect(runAutoSaveTick()).resolves.toEqual({ status: 'unavailable' });
    expect(useStore.getState().lastAutoSave).toBeNull();
  });

  it('réseau en erreur → silencieux, jamais bloquant', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(runAutoSaveTick()).resolves.toEqual({ status: 'unavailable' });
    expect(useStore.getState().lastAutoSave).toBeNull();
  });

  it('poste bien une sauvegarde FoodRecorder complète', async () => {
    let body = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: { method?: string; body?: string }) => {
        if (!init?.method) return { ok: true, json: async () => ({ available: true }) };
        body = init.body ?? '';
        return { ok: true, json: async () => ({ written: 'save/x.json' }) };
      }),
    );
    await runAutoSaveTick();
    const parsed = JSON.parse(body) as { app: string; entries: unknown[]; cloudApiKey?: string };
    expect(parsed.app).toBe('foodrecorder');
    expect(Array.isArray(parsed.entries)).toBe(true);
    // La clé API n'est jamais exportée (cf. backup.ts).
    expect(parsed.cloudApiKey).toBeUndefined();
  });
});
