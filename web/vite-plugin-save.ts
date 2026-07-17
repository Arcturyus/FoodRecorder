import type { Plugin } from 'vite';
import type { IncomingMessage } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Plugin de dev Vite : sauvegarde automatique du journal sur le disque.
 *
 * Le navigateur ne peut pas écrire dans le dossier du projet ; ce middleware le
 * fait à sa place. L'app poste sa sauvegarde une fois par jour, à la première
 * ouverture (cf. src/store/autosave.ts) : les données ne vivent alors plus
 * uniquement dans le localStorage, qu'un nettoyage de navigateur effacerait.
 *
 * Comme il dépend du serveur de dev, ce filet n'existe QUE sous `npm run dev`
 * (sur le site déployé, l'export manuel des Réglages reste la voie).
 *
 * Endpoints :
 *   GET  /api/save → { available: true, dir }
 *   POST /api/save → { written: "save/foodrecorder-2026-07-17.json" } | { error }
 *     body : la sauvegarde JSON complète (cf. buildBackup()).
 */

/** Garde-fou : une sauvegarde JSON pèse quelques Mo au grand maximum. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Dossier de sauvegarde : `save/` à la racine du dépôt, soit le parent de la
 * racine du projet Vite (`web/`). On part de `config.root` et NON de
 * `process.cwd()` : le cwd dépend de l'endroit d'où la commande est lancée
 * (`npm --prefix web run dev` depuis la racine écrirait alors à côté du dépôt).
 */
function saveDir(viteRoot: string): string {
  return resolve(viteRoot, '..', 'save');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > MAX_BODY_BYTES) {
        reject(new Error('Sauvegarde trop volumineuse.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/** Date locale (le fichier du jour, pas la date UTC). */
function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function autoSave(): Plugin {
  return {
    name: 'foodrecorder-autosave',
    configureServer(server) {
      const dir = saveDir(server.config.root);
      // Affiché au démarrage : on sait où chercher le fichier sans le deviner.
      server.config.logger.info(`[autosave] sauvegardes quotidiennes → ${dir}`);

      server.middlewares.use('/api/save', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.method === 'GET') {
            res.end(JSON.stringify({ available: true, dir }));
            return;
          }
          if (req.method === 'POST') {
            const body = await readBody(req);
            // On valide que c'est bien une sauvegarde FoodRecorder : ce endpoint
            // écrit sur le disque, il ne doit pas servir de dépotoir.
            let parsed: { app?: unknown; entries?: unknown };
            try {
              parsed = JSON.parse(body) as { app?: unknown; entries?: unknown };
            } catch {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'JSON invalide.' }));
              return;
            }
            if (parsed.app !== 'foodrecorder' || !Array.isArray(parsed.entries)) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Ce n’est pas une sauvegarde FoodRecorder.' }));
              return;
            }

            const name = `foodrecorder-${today()}.json`;
            const file = resolve(dir, name);
            await mkdir(dir, { recursive: true });
            await writeFile(file, body, 'utf8');
            // Chemin absolu : « save/… » ne dit pas où chercher sur le disque.
            server.config.logger.info(`[autosave] sauvegarde du jour écrite : ${file}`);
            res.end(JSON.stringify({ written: file }));
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
