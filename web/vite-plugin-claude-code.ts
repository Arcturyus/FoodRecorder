import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Plugin de dev Vite : pont HTTP local vers un CLI d'IA installé sur la machine
 * — « Claude Code » (`claude`) ou « Codex » (`codex`).
 *
 * Le navigateur ne peut pas lancer de process ; ce middleware le fait à sa place
 * et réutilise la session DÉJÀ authentifiée du CLI (abonnement Claude Pro/Max,
 * ChatGPT Plus…) — aucune clé API ni login à saisir dans l'app. Comme il dépend
 * du CLI installé et du serveur de dev, ce mode est « ordinateur uniquement »
 * (pas de mobile).
 *
 * Le nom du module et la route `/api/claude-code` sont d'époque, quand Claude
 * Code était le seul CLI supporté ; ils désignent aujourd'hui le pont en général.
 *
 * Chaque appel est archivé en entier dans `response/` (cf. writeResponseLog) :
 * prompt complet, raisonnement (thinking), texte de sortie, modèle, coût, tokens
 * et flux brut du CLI — pour analyser après coup ce que le modèle a compris.
 *
 * Endpoints :
 *   GET  /api/claude-code  → { available, version?, error? }  (santé)
 *   POST /api/claude-code  → { text } | { error }             (extraction)
 *     body : { prompt, model?, label?, timeoutMs?, image?: { data: base64, mediaType } }
 *     `timeoutMs` relève le délai d'attente du CLI (borné, cf. CLI_TIMEOUT_MAX_MS)
 *     pour les appels lourds où l'utilisateur attend sciemment.
 *     `label` nomme le fichier d'archive (photo/repas/verify/soleil…). L'image
 *     éventuelle est écrite dans `response/` (conservée comme input du modèle),
 *     et son chemin est donné au CLI (qui sait lire les images).
 */

/**
 * Délai par défaut : la saisie d'un repas doit rester rapide, mieux vaut échouer
 * et retomber sur le parseur à règles que faire attendre devant un formulaire.
 */
const CLI_TIMEOUT_MS = 60_000;

/**
 * Plafond pour les appels qui l'assument (relecture d'un aliment : prompt long,
 * fiche de 39 valeurs à produire, et l'utilisateur attend volontiers puisqu'il
 * vient de cliquer « demander à l'IA »).
 */
const CLI_TIMEOUT_MAX_MS = 180_000;

/** Un bloc de contenu d'un message assistant du flux stream-json. */
interface StreamBlock {
  type?: string;
  text?: string;
  thinking?: string;
}
interface StreamMessage {
  type?: string;
  message?: { model?: string; content?: StreamBlock[] };
  result?: unknown;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  modelUsage?: Record<string, unknown>;
}

/** CLI local que le pont sait piloter. */
type Cli = 'claude' | 'codex';

const CLI_LABEL: Record<Cli, string> = { claude: 'Claude Code', codex: 'Codex' };

/**
 * Codex CLI resolves its user configuration via HOME on Windows. A logon task
 * provides USERPROFILE but may omit HOME, so pass the user's existing profile
 * directory only to the Codex child process (no credentials are copied).
 */
function spawnCli(cli: Cli, args: string[]) {
  const env = cli === 'codex' && !process.env.HOME && process.env.USERPROFILE
    ? { ...process.env, HOME: process.env.USERPROFILE }
    : undefined;
  return spawn(cli, args, { shell: true, ...(env ? { env } : {}) });
}

interface BridgeModel {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
}

interface ModelListResult {
  cli: Cli;
  models: BridgeModel[];
  source: 'account' | 'cli-help';
  warning?: string;
}

/** Résultat complet d'un appel CLI, tel qu'archivé dans `response/`. */
interface CliRun {
  /** Texte final (ligne `result`), ce que l'app consomme réellement. */
  text: string;
  /** Raisonnement concaténé (blocs `thinking`), vide si le modèle n'en émet pas. */
  thinking: string;
  isError: boolean;
  model: string | null;
  costUsd: number | null;
  durationMs: number | null;
  /** Le flux stream-json COMPLET, ligne par ligne (« tout en entier »). */
  messages: StreamMessage[];
  /** Sorties brutes, utiles au diagnostic mais jamais renvoyées au navigateur. */
  rawStdout?: string;
  rawStderr?: string;
}

/**
 * Lance le CLI en `stream-json --verbose` : contrairement à `--output-format
 * json`, ce format émet CHAQUE message (dont les blocs `thinking`), ce qui nous
 * permet d'archiver le raisonnement du modèle. On reconstitue ensuite le texte
 * final et le raisonnement à partir du flux.
 */
function runCli(
  cli: Cli,
  prompt: string,
  model?: string,
  timeoutMs?: number,
  imagePath?: string | null,
  outputLastPath?: string | null,
): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    // Deux CLI, deux protocoles :
    //  - `claude -p --output-format stream-json` émet chaque message, ce qui
    //    permet d'archiver le raisonnement, le coût et le modèle réellement servi ;
    //  - `codex exec -` lit le prompt sur stdin et n'imprime QUE le message final
    //    sur stdout (sa progression part sur stderr). Pas de raisonnement ni de
    //    coût à archiver, mais le texte, lui, est directement exploitable.
    //    `--sandbox read-only` est le mode par défaut : on l'écrit quand même,
    //    car c'est lui qui garantit qu'aucune approbation ne sera demandée.
    const args =
      cli === 'codex'
        ? ['exec', '--sandbox', 'read-only', '--color', 'never', ...(outputLastPath ? ['--output-last-message', outputLastPath] : []), ...(model ? ['-m', model] : []), ...(imagePath ? ['-i', imagePath] : []), '-']
        : ['-p', '--output-format', 'stream-json', '--verbose', ...(model ? ['--model', model] : [])];
    // shell:true pour résoudre « claude(.cmd) » / « codex(.cmd) » via le PATH sous Windows.
    const child = spawnCli(cli, args);

    const limite = Math.min(Math.max(timeoutMs ?? CLI_TIMEOUT_MS, CLI_TIMEOUT_MS), CLI_TIMEOUT_MAX_MS);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Délai dépassé (${Math.round(limite / 1000)} s) : le CLI ${CLI_LABEL[cli]} n’a pas répondu.`));
    }, limite);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Impossible de lancer « ${cli} » : ${e.message}. CLI installé et dans le PATH ?`));
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      // Codex peut imprimer sa progression sur stdout selon son lanceur Windows.
      // `--output-last-message` est donc la seule source fiable du texte final.
      let codexFinal = '';
      if (cli === 'codex' && outputLastPath) {
        try { codexFinal = (await readFile(outputLastPath, 'utf8')).trim(); } catch { /* appel sans message final */ }
      }
      const run: CliRun =
        cli === 'codex'
          ? { text: codexFinal, thinking: '', isError: false, model: model ?? null, costUsd: null, durationMs: null, messages: [], rawStdout: stdout, rawStderr: stderr }
          : parseStream(stdout);

      // Un CLI qui a RÉPONDU est un succès, même s'il sort en code non nul :
      // les deux écrivent des avertissements sur stderr (sandbox indisponible,
      // quota bientôt atteint) et peuvent finir en erreur alors que le flux
      // contient la réponse. La jeter ferait retomber la saisie sur le parseur
      // à règles alors que l'IA avait bien travaillé.
      if (run.text.trim()) {
        resolve(run);
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Le CLI ${CLI_LABEL[cli]} a quitté (code ${code}).`));
        return;
      }
      resolve(run);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** Reconstitue texte final + raisonnement + métadonnées depuis le flux JSONL. */
function parseStream(stdout: string): CliRun {
  const messages: StreamMessage[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      messages.push(JSON.parse(t) as StreamMessage);
    } catch {
      // Ligne partielle ou non-JSON : on l'ignore, le reste du flux reste exploitable.
    }
  }

  const result = messages.find((m) => m.type === 'result');
  const blocks = messages
    .filter((m) => m.type === 'assistant')
    .flatMap((m) => m.message?.content ?? []);
  const thinking = blocks
    .filter((b) => b.type === 'thinking')
    .map((b) => b.thinking ?? '')
    .join('\n');
  const textFromBlocks = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  const text = typeof result?.result === 'string' ? result.result : textFromBlocks;
  const model = result?.modelUsage
    ? Object.keys(result.modelUsage).join(', ')
    : messages.find((m) => m.type === 'assistant')?.message?.model ?? null;

  return {
    text,
    thinking,
    isError: result?.is_error === true,
    model,
    costUsd: typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null,
    durationMs: typeof result?.duration_ms === 'number' ? result.duration_ms : null,
    messages,
  };
}

function checkCli(cli: Cli): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawnCli(cli, ['--version']);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ available: false, error: e.message }));
    child.on('close', (code) =>
      resolve(code === 0 ? { available: true, version: out.trim() } : { available: false, error: `code ${code}` }),
    );
  });
}

function captureCli(cli: Cli, args: string[], timeoutMs = 15_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnCli(cli, args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`Délai dépassé pendant l’interrogation de ${CLI_LABEL[cli]}.`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${CLI_LABEL[cli]} a quitté avec le code ${code}.`));
    });
  });
}

/** Catalogue réellement renvoyé par le compte authentifié au Codex app-server. */
function listCodexModels(): Promise<ModelListResult> {
  return new Promise((resolve, reject) => {
    const child = spawnCli('codex', ['app-server', '--listen', 'stdio://']);
    let buffer = '';
    let stderr = '';
    let settled = false;
    const finish = (error?: Error, result?: ModelListResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error) reject(error); else resolve(result!);
    };
    const timer = setTimeout(() => finish(new Error('Délai dépassé pendant la lecture des modèles Codex.')), 20_000);
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex app-server a quitté avec le code ${code}.`));
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: any;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) { finish(new Error(message.error.message ?? 'Initialisation Codex refusée.')); return; }
          child.stdin.write(`${JSON.stringify({ method: 'initialized', params: {} })}\n`);
          child.stdin.write(`${JSON.stringify({ id: 2, method: 'model/list', params: { includeHidden: false, limit: 100 } })}\n`);
        }
        if (message.id === 2) {
          if (message.error) { finish(new Error(message.error.message ?? 'Catalogue Codex indisponible.')); return; }
          const data = Array.isArray(message.result?.data) ? message.result.data : [];
          finish(undefined, {
            cli: 'codex',
            source: 'account',
            models: data.filter((m: any) => typeof m?.model === 'string').map((m: any) => ({
              id: m.model,
              label: typeof m.displayName === 'string' ? m.displayName : m.model,
              description: typeof m.description === 'string' ? m.description : undefined,
              isDefault: m.isDefault === true,
            })),
          });
          return;
        }
      }
    });
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'foodrecorder', title: 'FoodRecorder', version: '0.1.0' }, capabilities: {} } })}\n`);
  });
}

/**
 * Claude Code n'expose pas de catalogue compte en mode non interactif. On lit
 * donc les alias annoncés par LA VERSION installée, après contrôle de session,
 * sans consommer une génération juste pour tester chaque modèle.
 */
async function listClaudeModels(): Promise<ModelListResult> {
  const auth = await captureCli('claude', ['auth', 'status', '--json']);
  try {
    const status = JSON.parse(auth.stdout) as { loggedIn?: boolean };
    if (status.loggedIn === false) throw new Error('Claude Code n’est pas connecté.');
  } catch (e) {
    if ((e as Error).message.includes('n’est pas connecté')) throw e;
    // Une ancienne version peut répondre en texte malgré --json : le code 0
    // reste alors la meilleure preuve de session disponible.
  }
  const help = await captureCli('claude', ['--help']);
  const section = help.stdout.match(/--model <model>([\s\S]*?)(?:\n\s{2}--|\nCommands:)/)?.[1] ?? '';
  const ids = [...section.matchAll(/['"]([A-Za-z0-9._-]+)['"]/g)].map((m) => m[1]);
  const models = [...new Set(ids)].map((id) => ({ id, label: id }));
  if (!models.length) throw new Error('Cette version de Claude Code ne publie aucun alias de modèle dans son aide.');
  return {
    cli: 'claude',
    source: 'cli-help',
    models,
    warning: 'Claude Code ne publie pas la liste exacte autorisée par le compte : alias annoncés par le CLI, accès vérifié au premier envoi.',
  };
}

function listCliModels(cli: Cli): Promise<ModelListResult> {
  return cli === 'codex' ? listCodexModels() : listClaudeModels();
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * Dossier d'archive : `response/` à la racine du dépôt, soit le parent de la
 * racine Vite (`web/`) — même convention que `save/` (cf. vite-plugin-save.ts).
 * On part de `config.root` et non de `process.cwd()`, indépendant du dossier
 * d'où la commande est lancée.
 */
function responseDir(viteRoot: string): string {
  return resolve(viteRoot, '..', 'response');
}

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Horodatage local, sûr pour un nom de fichier : `2026-07-18_14-30-05-123`. */
function stamp(): string {
  const d = new Date();
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`
  );
}

/** Réduit un label libre à un fragment de nom de fichier sûr. */
function safeLabel(label: string): string {
  const s = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'appel';
}

export function claudeCodeBridge(): Plugin {
  return {
    name: 'claude-code-bridge',
    configureServer(server) {
      const dir = responseDir(server.config.root);
      // Affiché au démarrage : on sait où retrouver les réponses archivées.
      server.config.logger.info(`[claude-code] réponses archivées → ${dir}`);

      server.middlewares.use('/api/claude-code', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.method === 'GET') {
            const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
            const cli: Cli = query.get('cli') === 'codex' ? 'codex' : 'claude';
            res.end(JSON.stringify(query.get('models') === '1' ? await listCliModels(cli) : await checkCli(cli)));
            return;
          }
          if (req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}') as {
              prompt?: unknown;
              cli?: unknown;
              model?: unknown;
              label?: unknown;
              timeoutMs?: unknown;
              image?: { data?: unknown; mediaType?: unknown };
            };
            const prompt = typeof body.prompt === 'string' ? body.prompt : '';
            if (!prompt.trim()) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Prompt vide.' }));
              return;
            }

            const hasImage = Boolean(body.image && typeof body.image.data === 'string');
            const label = typeof body.label === 'string' && body.label.trim() ? body.label : hasImage ? 'photo' : 'text';
            const base = `${stamp()}-${safeLabel(label)}`;
            const outputLastPath = resolve(dir, `${base}-final.txt`);
            const model = typeof body.model === 'string' ? body.model : undefined;
            if (model && !/^[A-Za-z0-9._:/-]{1,128}$/.test(model)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Identifiant de modèle invalide.' }));
              return;
            }
            const cli: Cli = body.cli === 'codex' ? 'codex' : 'claude';
            await mkdir(dir, { recursive: true });

            // Photo éventuelle : écrite dans response/ (conservée comme input du
            // modèle, pas supprimée), et son chemin est donné au CLI qui la lit.
            let imageMeta: { file: string; mediaType: string; bytes: number } | null = null;
            let imagePath: string | null = null;
            if (hasImage) {
              const mediaType = String(body.image!.mediaType);
              const buffer = Buffer.from(body.image!.data as string, 'base64');
              const imageFile = `${base}.${EXT[mediaType] ?? 'jpg'}`;
              imagePath = resolve(dir, imageFile);
              await writeFile(imagePath, buffer);
              imageMeta = { file: imageFile, mediaType, bytes: buffer.length };
            }

            const fullPrompt = imagePath
              ? `${prompt}\n\nLa photo du repas à analyser est ce fichier image : ${imagePath}\nLis ce fichier, puis réponds UNIQUEMENT avec le JSON demandé.`
              : prompt;

            const startedAt = new Date().toISOString();
            let run: CliRun | null = null;
            let error: string | null = null;
            try {
              run = await runCli(
                cli,
                fullPrompt,
                model,
                typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
                imagePath,
                cli === 'codex' ? outputLastPath : null,
              );
            } catch (e) {
              error = (e as Error).message;
            }

            // Archive complète de l'appel, quel que soit son sort (réussi ou non).
            await writeFile(
              resolve(dir, `${base}.json`),
              JSON.stringify({ startedAt, cli, label, model: model ?? '(défaut)', prompt: fullPrompt, image: imageMeta, response: run, error }, null, 2),
              'utf8',
            );
            server.config.logger.info(`[claude-code] réponse archivée : ${base}.json`);

            if (error) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error }));
              return;
            }
            if (run!.isError) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: run!.text }));
              return;
            }
            res.end(JSON.stringify({ text: run!.text }));
            return;
          }
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Méthode non supportée.' }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
    },
  };
}
