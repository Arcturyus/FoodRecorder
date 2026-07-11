import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Plugin de dev Vite : pont HTTP local vers le CLI « Claude Code ».
 *
 * Le navigateur ne peut pas lancer de process ; ce middleware le fait à sa place
 * et réutilise la session DÉJÀ authentifiée du CLI (abonnement Claude Pro/Max) —
 * aucune clé API ni login à saisir dans l'app. Comme il dépend du CLI installé et
 * du serveur de dev, ce mode est « ordinateur uniquement » (pas de mobile).
 *
 * Endpoints :
 *   GET  /api/claude-code  → { available, version?, error? }  (santé)
 *   POST /api/claude-code  → { text } | { error }             (extraction)
 *     body : { prompt, model?, image?: { data: base64, mediaType } }
 *     L'image éventuelle est écrite dans un fichier temporaire dont le chemin
 *     est donné au CLI (qui sait lire les images), puis supprimée.
 */

const CLI_TIMEOUT_MS = 60_000;

function runClaude(prompt: string, model?: string): Promise<{ text: string }> {
  return new Promise((resolve, reject) => {
    const args = ['-p', '--output-format', 'json'];
    if (model) args.push('--model', model);
    // shell:true pour résoudre « claude(.cmd) » via le PATH (npm global) sous Windows.
    const child = spawn('claude', args, { shell: true });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Délai dépassé : le CLI Claude n’a pas répondu.'));
    }, CLI_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Impossible de lancer « claude » : ${e.message}. CLI installé et dans le PATH ?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Le CLI Claude a quitté (code ${code}).`));
        return;
      }
      // --output-format json → { result: "…", is_error, subtype, … }
      try {
        const parsed = JSON.parse(stdout) as { result?: unknown; is_error?: boolean };
        if (typeof parsed.result === 'string') {
          if (parsed.is_error) reject(new Error(parsed.result));
          else resolve({ text: parsed.result });
          return;
        }
      } catch {
        // sortie non structurée : on renvoie le texte brut
      }
      resolve({ text: stdout });
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function checkClaude(): Promise<{ available: boolean; version?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], { shell: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) => resolve({ available: false, error: e.message }));
    child.on('close', (code) =>
      resolve(code === 0 ? { available: true, version: out.trim() } : { available: false, error: `code ${code}` }),
    );
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function claudeCodeBridge(): Plugin {
  return {
    name: 'claude-code-bridge',
    configureServer(server) {
      server.middlewares.use('/api/claude-code', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.method === 'GET') {
            res.end(JSON.stringify(await checkClaude()));
            return;
          }
          if (req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}') as {
              prompt?: unknown;
              model?: unknown;
              image?: { data?: unknown; mediaType?: unknown };
            };
            const prompt = typeof body.prompt === 'string' ? body.prompt : '';
            if (!prompt.trim()) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Prompt vide.' }));
              return;
            }

            // Photo éventuelle : écrite en fichier temporaire, le CLI la lit lui-même.
            let imagePath: string | null = null;
            if (body.image && typeof body.image.data === 'string') {
              const EXT: Record<string, string> = {
                'image/jpeg': 'jpg',
                'image/png': 'png',
                'image/webp': 'webp',
                'image/gif': 'gif',
              };
              const ext = EXT[String(body.image.mediaType)] ?? 'jpg';
              imagePath = join(tmpdir(), `foodrecorder-photo-${Date.now()}.${ext}`);
              await writeFile(imagePath, Buffer.from(body.image.data, 'base64'));
            }

            try {
              const fullPrompt = imagePath
                ? `${prompt}\n\nLa photo du repas à analyser est ce fichier image : ${imagePath}\nLis ce fichier, puis réponds UNIQUEMENT avec le JSON demandé.`
                : prompt;
              const result = await runClaude(fullPrompt, typeof body.model === 'string' ? body.model : undefined);
              res.end(JSON.stringify(result));
            } finally {
              if (imagePath) unlink(imagePath).catch(() => {});
            }
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
