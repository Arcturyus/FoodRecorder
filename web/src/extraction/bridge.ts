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
  return useStore.getState().cliModels[currentCli()]?.trim() || undefined;
}

export interface BridgeRequest {
  prompt: string;
  /** Nomme le fichier d'archive côté serveur (photo/repas/verify/soleil…). */
  label?: string;
  /** Relève le délai d'attente pour un appel lourd assumé par l'utilisateur. */
  timeoutMs?: number;
  image?: { data: string; mediaType: string };
  /** Permet au chat agent d'interrompre un tour long. */
  signal?: AbortSignal;
}

/**
 * Appelle le CLI et renvoie son texte final. Lève une erreur lisible si le pont
 * est absent (app servie ailleurs qu'en `npm run dev`), le CLI introuvable, ou
 * la commande en échec — l'appelant décide s'il replie ou remonte.
 */
export async function callBridge(req: BridgeRequest): Promise<string> {
  const { signal, ...payload } = req;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, cli: currentCli(), model: currentCliModel() }),
    signal,
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.text ?? '';
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
