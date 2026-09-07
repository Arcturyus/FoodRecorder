import { afterEach, describe, expect, it, vi } from 'vitest';
import { callBridge, currentCliModel, listBridgeModels } from '../src/extraction/bridge';
import { useStore } from '../src/store/store';

afterEach(() => vi.unstubAllGlobals());

describe('modèle du pont CLI', () => {
  it('mémorise un modèle distinct pour Claude et Codex', () => {
    useStore.setState({ cliBridge: 'codex', cliModels: {} });
    useStore.getState().setCliModel('codex', 'gpt-test');
    useStore.getState().setCliModel('claude', 'sonnet');
    expect(currentCliModel()).toBe('gpt-test');
    useStore.getState().setCliBridge('claude');
    expect(currentCliModel()).toBe('sonnet');
  });

  it('transmet au pont le CLI et le modèle choisis', async () => {
    useStore.setState({ cliBridge: 'codex', cliModels: { codex: 'gpt-test' } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'ok' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(callBridge({ prompt: 'test' })).resolves.toBe('ok');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      cli: 'codex', model: 'gpt-test', prompt: 'test',
    });
  });

  it('demande la liste au CLI sélectionné et conserve sa provenance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      cli: 'codex', source: 'account', models: [{ id: 'gpt-test', label: 'GPT test', isDefault: true }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(listBridgeModels('codex')).resolves.toMatchObject({
      source: 'account', models: [{ id: 'gpt-test', isDefault: true }],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/claude-code?cli=codex&models=1');
  });
});
