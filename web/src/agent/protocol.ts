import type { ZodType, ZodTypeDef } from 'zod';

export interface AgentToolCall {
  id: string;
  name: string;
  args: unknown;
  /** Erreur de décodage des arguments renvoyés par le fournisseur, avant validation Zod. */
  parseError?: string;
  /** Arguments bruts, conservés pour expliquer une erreur au modèle et dans l’UI. */
  rawArgs?: string;
}

export interface AgentToolResult {
  callId: string;
  name: string;
  ok: boolean;
  content: string;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimated?: boolean;
  provider?: string;
  model?: string;
  transport?: 'anthropic-tools' | 'openai-tools' | 'cli-json';
  stopReason?: string;
  latencyMs?: number;
  raw?: Record<string, unknown>;
}

export interface AgentTool<T> {
  name: string;
  description: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  jsonSchema: Record<string, unknown>;
  run: (args: T) => unknown | Promise<unknown>;
  policy?: 'read' | 'navigate' | 'confirm';
  prepare?: (args: T) => AgentActionPlan | Promise<AgentActionPlan>;
}

export interface AgentActionPlan {
  id: string;
  tool: string;
  args: unknown;
  preview: string;
  impact: string;
  precondition: string;
  undoable: boolean;
  /** Détail structuré pour afficher un vrai avant/après dans la confirmation. */
  changes?: AgentActionPreviewGroup[];
}

export interface AgentActionPreviewField {
  key: string;
  label: string;
  before: string | number | null;
  after: string | number | null;
  unit?: string;
}

export interface AgentActionPreviewGroup {
  id: string;
  label: string;
  fields: AgentActionPreviewField[];
}

export interface AgentActivity {
  id: string;
  at: number;
  tool: string;
  args: unknown;
  preview: string;
  status: 'confirmed' | 'refused' | 'undone' | 'conflict' | 'error';
  result?: unknown;
  createdIds?: string[];
  preimage?: unknown;
  error?: string;
  undoable: boolean;
}

export interface AgentLimits {
  maxToolCallsPerMessage: number;
  maxAgentTurns: number;
  maxOutputTokens: number;
  maxToolResultChars: number;
}

export interface AgentProgress {
  phase: 'model' | 'tools' | 'approval';
  turn: number;
  toolCalls: number;
  usage: AgentUsage;
  elapsedMs: number;
  currentOperation?: AgentLiveOperation;
}

export interface AgentLiveOperation {
  kind: 'model' | 'tool';
  label: string;
  detail?: string;
  state?: 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'stopped';
  command?: string;
  promptChars?: number;
  estimatedPromptTokens?: number;
  pid?: number;
  startedAt?: number;
  lastOutputAt?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
}

export type AgentApprovalMode = 'confirm-writes' | 'approve-task-writes' | 'auto-accept-writes';

export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxToolCallsPerMessage: 20,
  maxAgentTurns: 15,
  maxOutputTokens: 100_000,
  maxToolResultChars: 180_000,
};
