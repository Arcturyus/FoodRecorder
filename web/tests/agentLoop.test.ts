import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAgent } from '../src/agent/loop';
import { askAgentEngine } from '../src/agent/engine';
import { DEFAULT_AGENT_LIMITS } from '../src/agent/protocol';
import { useStore } from '../src/store/store';

vi.mock('../src/agent/engine', () => ({ askAgentEngine: vi.fn() }));

const mockedEngine = vi.mocked(askAgentEngine);
const usage = (inputTokens: number, outputTokens: number, stopReason = 'stop') => ({
  inputTokens, outputTokens, stopReason, provider: 'test', model: 'test-model',
  transport: 'openai-tools' as const, latencyMs: 12, estimated: false,
});

beforeEach(() => {
  mockedEngine.mockReset();
  useStore.setState({ dayNotes: {} });
});

describe('boucle agentique', () => {
  it('exécute un tool puis renvoie la réponse en cumulant chaque appel modèle', async () => {
    mockedEngine
      .mockResolvedValueOnce({ kind: 'tool', text: '', calls: [{ id: 'c1', name: 'lire_profil_objectifs', args: {} }], usage: usage(100, 12, 'tool_calls') })
      .mockResolvedValueOnce({ kind: 'answer', text: 'Voici le résultat.', usage: usage(180, 30) });
    const events: unknown[] = [];
    const result = await runAgent([{ role: 'user', content: 'Quels sont mes objectifs ?' }], DEFAULT_AGENT_LIMITS, (event) => events.push(event));
    expect(result.text).toBe('Voici le résultat.');
    expect(result.toolCalls).toBe(1);
    expect(result.turns).toBe(2);
    expect(result.usage).toMatchObject({ inputTokens: 280, outputTokens: 42, latencyMs: 24 });
    expect(result.modelCalls).toHaveLength(2);
    expect(events).toHaveLength(2);
  });

  it('renvoie au modèle une erreur d’arguments afin qu’il puisse se corriger', async () => {
    mockedEngine
      .mockResolvedValueOnce({ kind: 'tool', text: '', calls: [{ id: 'bad', name: 'lire_poids', args: { debut: 'demain' } }], usage: usage(10, 3, 'tool_calls') })
      .mockResolvedValueOnce({ kind: 'answer', text: 'Il me faut une période précise.', usage: usage(20, 5) });
    await runAgent([{ role: 'user', content: 'Mon poids ?' }], DEFAULT_AGENT_LIMITS, () => {});
    const scratch = mockedEngine.mock.calls[1][1];
    expect(scratch[0].result.ok).toBe(false);
    expect(scratch[0].result.content).toContain('arguments invalides');
  });

  it('bloque un tool dont la politique est absente au lieu de l’exécuter', async () => {
    const tool = (await import('../src/agent/tools')).findTool('lire_profil_objectifs')!;
    const original = tool.policy;
    tool.policy = undefined;
    mockedEngine
      .mockResolvedValueOnce({ kind: 'tool', text: '', calls: [{ id: 'unsafe', name: tool.name, args: {} }], usage: usage(10, 3, 'tool_calls') })
      .mockResolvedValueOnce({ kind: 'answer', text: 'Action bloquée.', usage: usage(20, 5) });
    try {
      const result = await runAgent([{ role: 'user', content: 'Test' }], DEFAULT_AGENT_LIMITS, () => {});
      expect(result.text).toBe('Action bloquée.');
      expect(mockedEngine.mock.calls[1][1][0].result).toMatchObject({ ok: false });
      expect(mockedEngine.mock.calls[1][1][0].result.content).toContain('politique d’autorisation absente');
    } finally {
      tool.policy = original;
    }
  });

  it('signale explicitement une réponse coupée par le plafond de sortie', async () => {
    mockedEngine.mockResolvedValueOnce({ kind: 'answer', text: 'Début de réponse', usage: usage(30, 256, 'length') });
    const result = await runAgent([{ role: 'user', content: 'Explique tout' }], { ...DEFAULT_AGENT_LIMITS, maxOutputTokens: 256 }, () => {});
    expect(result.text).toContain('Réponse interrompue');
    expect(result.text).toContain('256');
  });

  it('bloque un lot parallèle dépassant le plafond d’outils', async () => {
    mockedEngine.mockResolvedValueOnce({ kind: 'tool', text: '', calls: [
      { id: '1', name: 'lire_profil_objectifs', args: {} },
      { id: '2', name: 'lire_profil_objectifs', args: {} },
    ], usage: usage(10, 3, 'tool_calls') });
    await expect(runAgent([{ role: 'user', content: 'Tout' }], { ...DEFAULT_AGENT_LIMITS, maxToolCallsPerMessage: 1 }, () => {}))
      .rejects.toThrow('1 appels d’outils');
  });

  it('suspend une écriture jusqu’à confirmation puis renvoie son résultat au modèle', async () => {
    mockedEngine
      .mockResolvedValueOnce({ kind: 'tool', text: '', calls: [{ id: 'write', name: 'noter_jour', args: { date: '2026-08-31', note: 'Test agent' } }], usage: usage(10, 3, 'tool_calls') })
      .mockResolvedValueOnce({ kind: 'answer', text: 'Note ajoutée.', usage: usage(20, 5) });
    let requested = false;
    const result = await runAgent([{ role: 'user', content: 'Note Test agent aujourd’hui' }], DEFAULT_AGENT_LIMITS, () => {}, undefined, async () => { requested = true; return true; });
    expect(requested).toBe(true);
    expect(result.text).toBe('Note ajoutée.');
    expect(mockedEngine.mock.calls[1][1][0].result.content).toContain('2026-08-31');
  });

  it('exécute une écriture sans pause uniquement en mode tout accepter et poursuit la tâche', async () => {
    mockedEngine
      .mockResolvedValueOnce({ kind: 'tool', text: '', calls: [{ id: 'write-auto', name: 'noter_jour', args: { date: '2026-08-30', note: 'Auto' } }], usage: usage(10, 3, 'tool_calls') })
      .mockResolvedValueOnce({ kind: 'answer', text: 'Note ajoutée, analyse terminée.', usage: usage(20, 5) });
    const approval = vi.fn(async () => true);
    const result = await runAgent([{ role: 'user', content: 'Ajoute puis continue' }], DEFAULT_AGENT_LIMITS, () => {}, undefined, approval, 'auto-accept-writes');
    expect(approval).not.toHaveBeenCalled();
    expect(useStore.getState().dayNotes['2026-08-30']).toBe('Auto');
    expect(result.text).toContain('analyse terminée');
    expect(mockedEngine).toHaveBeenCalledTimes(2);
  });

  it('enchaîne plusieurs lectures dans une analyse complexe', async () => {
    mockedEngine
      .mockResolvedValueOnce({ kind: 'tool', text: '', calls: [
        { id: 'profile', name: 'lire_profil_objectifs', args: {} },
        { id: 'nutrients', name: 'moyenne_nutriments', args: { debut: '2026-08-01', fin: '2026-08-31' } },
      ], usage: usage(40, 8, 'tool_calls') })
      .mockResolvedValueOnce({ kind: 'answer', text: 'Analyse croisée.', usage: usage(80, 16) });
    const result = await runAgent([{ role: 'user', content: 'Analyse la cohérence avec mon objectif.' }], DEFAULT_AGENT_LIMITS, () => {});
    expect(result.toolCalls).toBe(2);
    expect(mockedEngine.mock.calls[1][1]).toHaveLength(2);
    expect(result.text).toBe('Analyse croisée.');
  });

  it('ne demande qu’une confirmation pour plusieurs écritures du même message en mode tâche', async () => {
    mockedEngine
      .mockResolvedValueOnce({ kind: 'tool', text: '', calls: [
        { id: 'note-1', name: 'noter_jour', args: { date: '2026-08-27', note: 'A' } },
        { id: 'note-2', name: 'noter_jour', args: { date: '2026-08-28', note: 'B' } },
      ], usage: usage(20, 5, 'tool_calls') })
      .mockResolvedValueOnce({ kind: 'answer', text: 'Deux notes ajoutées.', usage: usage(30, 8) });
    const approval = vi.fn(async () => true);
    await runAgent([{ role: 'user', content: 'Ajoute les deux notes' }], DEFAULT_AGENT_LIMITS, () => {}, undefined, approval, 'approve-task-writes');
    expect(approval).toHaveBeenCalledTimes(1);
    expect(useStore.getState().dayNotes).toMatchObject({ '2026-08-27': 'A', '2026-08-28': 'B' });
  });
});
