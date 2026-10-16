import { useStore, type CliBridge } from '../store/store';

/**
 * Accès unique au pont CLI local (cf. vite-plugin-claude-code.ts).
 *
 * Le CLI visé — `claude` ou `codex` — est un réglage de la MACHINE, pas un
 * paramètre d'appel : il est donc lu ici dans le store au moment de l'appel
 * plutôt que passé de main en main à travers les six extracteurs. Rien à
 * resynchroniser, et un changement dans les Réglages vaut immédiatement pour
 * tout le monde.
 *
 * Le chemin `/api/claude-code` est d'époque (Claude Code était le seul CLI
 * supporté) ; il sert aujourd'hui les deux.
 */

const ENDPOINT = '/api/claude-code';

export const CLI_LABELS: Record<CliBridge, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

/** Modèle Codex utilisé par FoodRecorder quand aucun modèle n'est choisi dans ses réglages. */
const DEFAULT_CODEX_MODEL = 'gpt-6-luna';

/** CLI actuellement choisi dans les Réglages. */
export function currentCli(): CliBridge {
  return useStore.getState().cliBridge;
}

/** Nom lisible du CLI choisi, pour les messages d'erreur et l'UI. */
export function currentCliLabel(): string {
  return CLI_LABELS[currentCli()] ?? CLI_LABELS.claude;
}

/** Modèle explicitement choisi pour le CLI actif, ou défaut géré par le CLI. */
export function currentCliModel(): string | undefined {
  const cli = currentCli();
  const configured = useStore.getState().cliModels[cli]?.trim();
  return configured || (cli === 'codex' ? DEFAULT_CODEX_MODEL : undefined);
}

export interface BridgeRequest {
  prompt: string;
  /** Remplace le modèle enregistré pour cet appel seulement. */
  model?: string;
  /** Nomme le fichier d'archive côté serveur (photo/repas/verify/soleil…). */
  label?: string;
  /** Relève le délai d'attente pour un appel lourd assumé par l'utilisateur. */
  timeoutMs?: number;
  /** Désactive l'archive locale pour les traitements automatiques en arrière-plan. */
  archive?: boolean;
  image?: { data: string; mediaType: string };
  /** Permet au chat agent d'interrompre un tour long. */
  signal?: AbortSignal;
  /** Remonte au chat le processus CLI actuellement lancé, sans son prompt. */
  onStatus?: (status: CliExecutionStatus) => void;
}

export interface CliExecutionStatus {
  state: 'starting' | 'running' | 'stopping' | 'completed' | 'failed' | 'stopped';
  cli: CliBridge;
  command: string;
  pid?: number;
  startedAt: number;
  lastOutputAt: number;
  stdoutBytes: number;
  stderrBytes: number;
}

/**
 * Appelle le CLI et renvoie son texte final. Lève une erreur lisible si le pont
 * est absent (app servie ailleurs qu'en `npm run dev`), le CLI introuvable, ou
 * la commande en échec — l'appelant décide s'il replie ou remonte.
 */
export async function callBridge(req: BridgeRequest): Promise<string> {
  const { signal, model, onStatus, ...payload } = req;
  const requestId = onStatus ? crypto.randomUUID() : undefined;
  const statusAbort = new AbortController();
  let polling = false;
  let latestStatus: CliExecutionStatus | undefined;
  const pollStatus = async () => {
    if (!requestId || polling || statusAbort.signal.aborted) return;
    polling = true;
    try {
      const statusRes = await fetch(`${ENDPOINT}?status=${encodeURIComponent(requestId)}`, { signal: statusAbort.signal });
      if (!statusRes.ok) return;
      const status = await statusRes.json() as CliExecutionStatus | null;
      if (status?.state) {
        latestStatus = status;
        onStatus?.(status);
      }
    } catch {
      // Le diagnostic reste facultatif ; la réponse du CLI contient l'erreur principale.
    } finally {
      polling = false;
    }
  };
  const pollTimer = requestId ? window.setInterval(() => { void pollStatus(); }, 500) : undefined;
  if (requestId) void pollStatus();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, ...(requestId ? { requestId } : {}), cli: currentCli(), model: model?.trim() || currentCliModel() }),
      signal,
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    if (requestId) {
      await pollStatus();
      if (latestStatus) {
        latestStatus = { ...latestStatus, state: 'completed' };
        onStatus?.(latestStatus);
      }
    }
    return data.text ?? '';
  } catch (error) {
    if (requestId) {
      await pollStatus();
      const now = Date.now();
      latestStatus = latestStatus
        ? { ...latestStatus, state: signal?.aborted ? 'stopped' : 'failed' }
        : { state: signal?.aborted ? 'stopped' : 'failed', cli: currentCli(), command: 'Commande CLI non terminée', startedAt: now, lastOutputAt: now, stdoutBytes: 0, stderrBytes: 0 };
      onStatus?.(latestStatus);
    }
    throw error;
  } finally {
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    statusAbort.abort();
  }
}

export interface BridgeStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface BridgeModel {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

export interface BridgeModelsResult {
  cli: CliBridge;
  models: BridgeModel[];
  source: 'account' | 'cli-help';
  warning?: string;
}

/** Santé du pont + du CLI demandé (le middleware n'existe qu'en dev). */
export async function checkBridge(cli: CliBridge = currentCli()): Promise<BridgeStatus> {
  try {
    const res = await fetch(`${ENDPOINT}?cli=${cli}`);
    if (!res.ok) return { available: false, error: `HTTP ${res.status}` };
    return (await res.json()) as BridgeStatus;
  } catch (e) {
    return { available: false, error: (e as Error).message };
  }
}

/** Interroge la CLI installée au clic, sans lancer de génération de chat. */
export async function listBridgeModels(cli: CliBridge = currentCli()): Promise<BridgeModelsResult> {
  const res = await fetch(`${ENDPOINT}?cli=${cli}&models=1`);
  const data = (await res.json().catch(() => ({}))) as Partial<BridgeModelsResult> & { error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return {
    cli,
    models: Array.isArray(data.models) ? data.models : [],
    source: data.source === 'account' ? 'account' : 'cli-help',
    warning: data.warning,
  };
}
