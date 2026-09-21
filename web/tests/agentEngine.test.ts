import { afterEach, describe, expect, it, vi } from 'vitest';
import { askAgentEngine } from '../src/agent/engine';
import { DEFAULT_AGENT_LIMITS } from '../src/agent/protocol';
import { useStore } from '../src/store/store';

const anthropicCreate = vi.hoisted(() => vi.fn());
vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock { messages = { create: anthropicCreate }; },
}));

afterEach(() => vi.unstubAllGlobals());

describe('transport function calling OpenAI-compatible', () => {
  it('envoie les schémas natifs, lit les tool_calls et expose l’usage réel', async () => {
    useStore.setState({
      extractionMode: 'cloud', cloudProvider: 'openai',
      cloudApiKeys: { openai: 'test-key' }, cloudModels: { openai: 'gpt-test' },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: 'gpt-test-2026',
      choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lire_poids', arguments: '{"debut":"2026-01-01","fin":"2026-01-31"}' } }] } }],
      usage: { prompt_tokens: 321, completion_tokens: 17, completion_tokens_details: { reasoning_tokens: 8 }, prompt_tokens_details: { cached_tokens: 100 } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const reply = await askAgentEngine([{ role: 'user', content: 'Mon poids en janvier ?' }], [], DEFAULT_AGENT_LIMITS);
    expect(reply.kind).toBe('tool');
    if (reply.kind !== 'tool') throw new Error('appel tool attendu');
    expect(reply.calls[0]).toEqual({ id: 'call-1', name: 'lire_poids', args: { debut: '2026-01-01', fin: '2026-01-31' } });
    expect(reply.usage).toMatchObject({ inputTokens: 321, outputTokens: 17, reasoningTokens: 8, cacheReadTokens: 100, model: 'gpt-test-2026', stopReason: 'tool_calls', estimated: false });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_completion_tokens).toBe(DEFAULT_AGENT_LIMITS.maxOutputTokens);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools.length).toBeGreaterThanOrEqual(9);
    expect(body.tools[0]).toMatchObject({ type: 'function', function: { name: 'lire_repas' } });
  });

  it('préserve le diagnostic quand le fournisseur renvoie des arguments JSON mal formés', async () => {
    useStore.setState({
      extractionMode: 'cloud', cloudProvider: 'openai',
      cloudApiKeys: { openai: 'test-key' }, cloudModels: { openai: 'gpt-test' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'bad-json', type: 'function', function: { name: 'lire_poids', arguments: '{"debut":"2026-01-01" "fin":"2026-01-31"}' } }] } }],
      usage: {},
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const reply = await askAgentEngine([{ role: 'user', content: 'Mon poids ?' }], [], DEFAULT_AGENT_LIMITS);
    expect(reply.kind).toBe('tool');
    if (reply.kind !== 'tool') throw new Error('appel tool attendu');
    expect(reply.calls[0]).toMatchObject({
      id: 'bad-json', name: 'lire_poids', args: {},
      rawArgs: '{"debut":"2026-01-01" "fin":"2026-01-31"}',
    });
    expect(reply.calls[0].parseError).toMatch(/Expected ',' or '}'/);
  });
});

describe('autres transports agent', () => {
  it('décode un tool_use Anthropic et ses compteurs de cache', async () => {
    useStore.setState({ extractionMode: 'cloud', cloudProvider: 'anthropic', cloudApiKeys: { anthropic: 'test-key' }, cloudModels: { anthropic: 'claude-test' } });
    anthropicCreate.mockResolvedValueOnce({
      model: 'claude-test', stop_reason: 'tool_use',
      usage: { input_tokens: 90, output_tokens: 11, cache_read_input_tokens: 40, cache_creation_input_tokens: 5 },
      content: [{ type: 'tool_use', id: 'a1', name: 'lire_soleil', input: { debut: '2026-07-01', fin: '2026-07-07' } }],
    });
    const reply = await askAgentEngine([{ role: 'user', content: 'Mon soleil ?' }], [], DEFAULT_AGENT_LIMITS);
    expect(reply.kind).toBe('tool');
    if (reply.kind !== 'tool') throw new Error('appel tool attendu');
    expect(reply.calls[0].name).toBe('lire_soleil');
    expect(reply.usage).toMatchObject({ transport: 'anthropic-tools', inputTokens: 90, outputTokens: 11, cacheReadTokens: 40, cacheWriteTokens: 5 });
    expect(anthropicCreate.mock.calls[0][0].tools.length).toBeGreaterThanOrEqual(9);
  });

  it('garde le CLI en compatibilité JSON et étiquette ses tokens comme estimés', async () => {
    useStore.setState({ extractionMode: 'claudecode', cliBridge: 'codex' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '{"outil":"lire_profil_objectifs","args":{}}' }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const reply = await askAgentEngine([{ role: 'user', content: 'Mes objectifs ?' }], [], DEFAULT_AGENT_LIMITS);
    expect(reply.kind).toBe('tool');
    expect(reply.usage).toMatchObject({ provider: 'codex', model: 'codex (défaut CLI)', transport: 'cli-json', estimated: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ cli: 'codex', label: 'agent' });
    expect(body.prompt).toContain('lire_profil_objectifs');
  });
});
