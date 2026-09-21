import type { ChatTurn } from '../extraction/cloud';
import { askAgentEngine, type ScratchStep } from './engine';
import type { AgentActionPlan, AgentApprovalMode, AgentLimits, AgentProgress, AgentToolCall, AgentUsage } from './protocol';
import { findTool } from './tools';
import { executeAction, recordRefusal } from './actions';

export interface AgentRunEvent {
  type: 'tool-start' | 'tool-result' | 'action-pending' | 'action-confirmed' | 'action-refused';
  call: AgentToolCall;
  summary?: string;
  ok?: boolean;
  plan?: AgentActionPlan;
}

export interface AgentRunResult {
  text: string;
  toolCalls: number;
  turns: number;
  usage: AgentUsage;
  modelCalls: AgentUsage[];
}

function addUsage(total: AgentUsage, next: AgentUsage): AgentUsage {
  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    reasoningTokens: (total.reasoningTokens ?? 0) + (next.reasoningTokens ?? 0),
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0),
    cacheWriteTokens: (total.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0),
    latencyMs: (total.latencyMs ?? 0) + (next.latencyMs ?? 0),
    estimated: total.inputTokens === 0 ? next.estimated : total.estimated || next.estimated,
    provider: next.provider ?? total.provider,
    model: next.model ?? total.model,
    transport: next.transport ?? total.transport,
    stopReason: next.stopReason ?? total.stopReason,
    raw: next.raw ?? total.raw,
  };
}

function compact(value: unknown, maxChars: number): string {
  const full = JSON.stringify(value);
  if (full.length <= maxChars) return full;
  return `${full.slice(0, maxChars)}\n[TRONQUÉ : ${full.length - maxChars} caractères non transmis]`;
}

export async function runAgent(
  turns: ChatTurn[],
  limits: AgentLimits,
  onEvent: (event: AgentRunEvent) => void,
  signal?: AbortSignal,
  requestApproval?: (plan: AgentActionPlan) => Promise<boolean>,
  approvalMode: AgentApprovalMode = 'confirm-writes',
  onProgress?: (progress: AgentProgress) => void,
): Promise<AgentRunResult> {
  const scratchpad: ScratchStep[] = [];
  let toolCalls = 0;
  let usage: AgentUsage = { inputTokens: 0, outputTokens: 0, estimated: false };
  const modelCalls: AgentUsage[] = [];
  let taskWritesApproved = approvalMode === 'auto-accept-writes';
  const startedAt = Date.now();
  const progress = (phase: AgentProgress['phase'], turn: number) => onProgress?.({ phase, turn, toolCalls, usage: { ...usage }, elapsedMs: Date.now() - startedAt });

  for (let turn = 1; turn <= limits.maxAgentTurns; turn++) {
    progress('model', turn);
    const reply = await askAgentEngine(turns, scratchpad, limits, signal);
    modelCalls.push(reply.usage);
    usage = addUsage(usage, reply.usage);
    progress('tools', turn);
    if (reply.kind === 'answer') {
      const limited = reply.usage.stopReason === 'max_tokens' || reply.usage.stopReason === 'length';
      const text = limited
        ? `${reply.text}\n\n⚠️ Réponse interrompue par le plafond de tokens (${limits.maxOutputTokens} par appel). Augmentez « Tokens sortie/appel » ou demandez une réponse plus courte.`
        : reply.text;
      return { text, toolCalls, turns: turn, usage, modelCalls };
    }
    if (toolCalls + reply.calls.length > limits.maxToolCallsPerMessage) {
      throw new Error(`Limite atteinte : ${limits.maxToolCallsPerMessage} appels d’outils pour ce message.`);
    }
    for (const call of reply.calls) {
      toolCalls++;
      progress('tools', turn);
      const tool = findTool(call.name);
      onEvent({ type: 'tool-start', call });
      if (!tool) {
      const summary = `ERREUR ${call.name}: outil inconnu.`;
      scratchpad.push({ call, result: { callId: call.id, name: call.name, ok: false, content: summary } });
      onEvent({ type: 'tool-result', call, summary, ok: false });
      continue;
    }
    if (call.parseError) {
      const raw = call.rawArgs === undefined ? '' : ` Arguments reçus : ${call.rawArgs}`;
      const summary = `ERREUR ${tool.name}: JSON d’arguments invalide: ${call.parseError}.${raw}`;
      scratchpad.push({ call, result: { callId: call.id, name: tool.name, ok: false, content: summary } });
      onEvent({ type: 'tool-result', call, summary, ok: false });
      continue;
    }
    const parsed = tool.schema.safeParse(call.args);
    if (!parsed.success) {
      const summary = `ERREUR ${tool.name}: arguments invalides: ${parsed.error.issues.map((i) => i.message).join('; ')}`;
      scratchpad.push({ call, result: { callId: call.id, name: call.name, ok: false, content: summary } });
      onEvent({ type: 'tool-result', call, summary, ok: false });
      continue;
    }
    try {
      let result: unknown;
      if (tool.policy === 'confirm') {
        if (!tool.prepare) throw new Error('Action sans générateur d’aperçu.');
        const actionPlan = await tool.prepare(parsed.data);
        let approved = taskWritesApproved;
        if (!approved) {
          progress('approval', turn);
          onEvent({ type: 'action-pending', call, plan: actionPlan, summary: `${actionPlan.preview} ${actionPlan.impact}` });
          if (!requestApproval) throw new Error('Cette action demande une confirmation dans l’interface.');
          approved = await requestApproval(actionPlan);
          progress('tools', turn);
          if (approved && approvalMode === 'approve-task-writes') taskWritesApproved = true;
        }
        if (!approved) {
          recordRefusal(actionPlan);
          result = { confirmed: false, refused: true };
          onEvent({ type: 'action-refused', call, plan: actionPlan, summary: 'Action refusée.', ok: true });
        } else {
          result = (await executeAction(actionPlan)).content;
          onEvent({ type: 'action-confirmed', call, plan: actionPlan, summary: 'Action confirmée et exécutée.', ok: true });
        }
      } else if (tool.policy === 'read' || tool.policy === 'navigate') {
        result = await tool.run(parsed.data);
      } else {
        throw new Error(`Outil « ${tool.name} » bloqué : politique d’autorisation absente.`);
      }
      const content = compact(result, limits.maxToolResultChars);
      scratchpad.push({ call, result: { callId: call.id, name: tool.name, ok: true, content } });
      onEvent({ type: 'tool-result', call, summary: content, ok: true });
    } catch (error) {
      const summary = `ERREUR ${tool.name}: ${error instanceof Error ? error.message : String(error)}`;
      scratchpad.push({ call, result: { callId: call.id, name: tool.name, ok: false, content: summary } });
      onEvent({ type: 'tool-result', call, summary, ok: false });
      }
    }
  }
  throw new Error(`Limite atteinte : ${limits.maxAgentTurns} tours agentiques.`);
}
