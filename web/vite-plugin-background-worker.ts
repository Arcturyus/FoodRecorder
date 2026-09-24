import type { IncomingMessage } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

interface WorkerConfig {
  enabled: boolean;
  profileConfigured: boolean;
}

interface WorkerReport {
  role: 'background' | 'setup';
  syncConfigured: boolean;
  profileId: string | null;
  profileName: string | null;
  sessionExpired: boolean;
  extractionMode: string;
  cliBridge: string;
}

interface BrowserState {
  enabled: boolean;
  running: boolean;
  mode: 'headless' | 'setup' | null;
  configured: boolean;
  syncConfigured: boolean | null;
  connected: boolean;
  sessionExpired: boolean;
  profileName: string | null;
  lastSeenAt: number | null;
  error: string | null;
}

function localDataDir(): string {
  const root = process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local');
  return resolve(root, 'FoodRecorder', 'background-worker');
}

function chromePath(): string | null {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local');
  const candidates = [
    resolve(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    resolve(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    resolve(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  return candidates.find(existsSync) ?? null;
}

function readBody(req: IncomingMessage, maxBytes = 16_384): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        reject(new Error('Requête trop volumineuse.'));
        req.destroy();
      }
    });
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

/** Gère le Chrome de fond local sans stocker le mot de passe du profil. */
export function backgroundWorker(): Plugin {
  const dataDir = localDataDir();
  const configPath = resolve(dataDir, 'config.json');
  const profileDir = resolve(dataDir, 'chrome-profile');
  let baseUrl = 'http://127.0.0.1:5173';
  let config: WorkerConfig = { enabled: false, profileConfigured: false };
  let report: WorkerReport | null = null;
  let lastSeenAt: number | null = null;
  let browser: ChildProcess | null = null;
  let browserMode: BrowserState['mode'] = null;
  let requestedMode: BrowserState['mode'] = null;
  let lifecycle = Promise.resolve();
  let error: string | null = null;
  let lastLaunchAt = 0;
  let headlessRestarts = 0;
  let watchdog: NodeJS.Timeout | null = null;
  let configReady: Promise<void> = Promise.resolve();

  async function loadConfig(): Promise<void> {
    try {
      const raw = (await readFile(configPath, 'utf8')).replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw) as Partial<WorkerConfig>;
      config = {
        enabled: parsed.enabled === true,
        profileConfigured: parsed.profileConfigured === true,
      };
    } catch {
      config = { enabled: false, profileConfigured: false };
    }
  }

  async function saveConfig(): Promise<void> {
    await mkdir(dataDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }

  function status(): BrowserState {
    const connected = Boolean(report?.profileId && !report.sessionExpired);
    const configured = Boolean(
      report?.syncConfigured && report.profileId && !report.sessionExpired &&
        report.extractionMode === 'claudecode' && report.cliBridge === 'codex',
    );
    const pageAlive = lastSeenAt !== null && Date.now() - lastSeenAt < 20_000;
    return {
      enabled: config.enabled,
      running: browser !== null || pageAlive,
      mode: browserMode,
      configured,
      syncConfigured: report?.syncConfigured ?? null,
      connected,
      sessionExpired: report?.sessionExpired ?? false,
      profileName: report?.profileName ?? null,
      lastSeenAt,
      error,
    };
  }

  function terminateBrowser(): Promise<void> {
    const current = browser;
    browser = null;
    browserMode = null;
    if (!current) return Promise.resolve();
    return new Promise((resolveDone) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolveDone();
      };
      const timeout = setTimeout(() => {
        current.kill();
        finish();
      }, 4_000);
      timeout.unref();

      if (process.platform === 'win32' && current.pid) {
        const killer = spawn('taskkill.exe', ['/PID', String(current.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('close', () => {
          clearTimeout(timeout);
          finish();
        });
        killer.once('error', () => {
          current.kill();
          clearTimeout(timeout);
          finish();
        });
      } else {
        current.kill();
        current.once('exit', () => {
          clearTimeout(timeout);
          finish();
        });
      }
    });
  }

  function stopBrowser(): void {
    requestedMode = null;
    lifecycle = lifecycle.then(terminateBrowser, terminateBrowser);
  }

  function spawnBrowser(mode: 'headless' | 'setup'): void {
    const chrome = chromePath();
    if (!chrome) {
      error = 'Google Chrome est introuvable sur cet ordinateur.';
      return;
    }
    error = null;
    const args = [
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(mode === 'headless' ? ['--headless'] : ['--new-window']),
      `${baseUrl}/?foodrecorderWorker${mode === 'headless' ? '=1' : 'Setup=1'}`,
    ];
    const child = spawn(chrome, args, { stdio: 'ignore', windowsHide: mode === 'headless' });
    browser = child;
    browserMode = mode;
    lastLaunchAt = Date.now();
    child.on('error', (e) => {
      if (browser !== child) return;
      browser = null;
      browserMode = null;
      error = `Impossible de lancer Chrome : ${e.message}`;
    });
    child.on('exit', (code) => {
      if (browser !== child) return;
      browser = null;
      // Sous Windows, chrome.exe peut transférer l'URL à son processus navigateur
      // puis quitter. Un heartbeat postérieur au lancement prouve que la page vit.
      const pageAlive = lastSeenAt !== null && lastSeenAt >= lastLaunchAt && Date.now() - lastSeenAt < 20_000;
      if (pageAlive) return;
      browserMode = null;
      if (code && code !== 0) error = `Chrome s’est arrêté (code ${code}).`;
    });
  }

  function launchBrowser(mode: 'headless' | 'setup', force = false): void {
    if (!force && requestedMode === mode && Date.now() - lastLaunchAt < 20_000) return;
    if (!force && browser && browserMode === mode) return;
    requestedMode = mode;
    lifecycle = lifecycle
      .then(async () => {
        if (requestedMode !== mode || (browser && browserMode === mode)) return;
        await terminateBrowser();
        if (requestedMode === mode) spawnBrowser(mode);
      })
      .catch((e) => {
        error = `Impossible de démarrer Chrome : ${(e as Error).message}`;
      });
  }

  async function acceptReport(next: WorkerReport): Promise<void> {
    report = next;
    lastSeenAt = Date.now();
    error = null;
    const reportConfigured = Boolean(
      next.syncConfigured && next.profileId && next.extractionMode === 'claudecode' && next.cliBridge === 'codex',
    );
    if (reportConfigured && !config.profileConfigured) {
      config.profileConfigured = true;
      await saveConfig();
    }

    if (!config.enabled) return;
    if (next.role === 'background') {
      headlessRestarts = 0;
      if ((!next.profileId || next.sessionExpired) && browserMode !== 'setup' && requestedMode !== 'setup') {
        launchBrowser('setup');
      }
      return;
    }
    if (next.role === 'setup' && reportConfigured && !next.sessionExpired && requestedMode !== 'headless') {
      // Laisse le panneau visible afficher la réussite avant de basculer sur le même profil headless.
      setTimeout(() => {
        if (config.enabled && browserMode === 'setup') launchBrowser('headless');
      }, 1_500).unref();
    }
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    config.enabled = enabled;
    await saveConfig();
    if (!enabled) {
      stopBrowser();
      return;
    }
    // Démarre toujours headless en premier : le worker réutilise sa session
    // persistante et n'ouvre une fenêtre que si elle manque/est expirée.
    launchBrowser('headless');
  }

  function sameLocalOrigin(req: IncomingMessage): boolean {
    try {
      const origin = new URL(req.headers.origin ?? '');
      const base = new URL(baseUrl);
      return origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname) &&
        origin.port === base.port;
    } catch {
      return false;
    }
  }

  return {
    name: 'foodrecorder-background-worker',
    configureServer(server) {
      server.middlewares.use('/api/background-worker', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        try {
          await configReady;
          if (req.method === 'GET') {
            res.end(JSON.stringify(status()));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: 'Méthode non supportée.' }));
            return;
          }
          if (!sameLocalOrigin(req)) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: 'Commande locale refusée depuis cette origine.' }));
            return;
          }
          const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
          if (body.action === 'enabled' && typeof body.enabled === 'boolean') {
            await setEnabled(body.enabled);
          } else if (body.action === 'setup') {
            launchBrowser('setup', true);
          } else if (body.action === 'report') {
            if (
              (body.role !== 'background' && body.role !== 'setup') ||
              typeof body.syncConfigured !== 'boolean' ||
              (body.profileId !== null && typeof body.profileId !== 'string') ||
              typeof body.sessionExpired !== 'boolean' ||
              typeof body.extractionMode !== 'string' ||
              typeof body.cliBridge !== 'string'
            ) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'État du worker invalide.' }));
              return;
            }
            await acceptReport(body as unknown as WorkerReport);
          } else {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Action du worker inconnue.' }));
            return;
          }
          res.end(JSON.stringify(status()));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });

      server.httpServer?.once('listening', async () => {
        const address = server.httpServer?.address();
        const port = address && typeof address === 'object' ? address.port : server.config.server.port ?? 5173;
        baseUrl = `http://127.0.0.1:${port}`;
        configReady = loadConfig();
        await configReady;
        if (config.enabled) launchBrowser('headless');
        watchdog = setInterval(() => {
          if (!config.enabled || requestedMode !== 'headless' || browser || headlessRestarts >= 1) return;
          if (Date.now() - lastLaunchAt < 20_000) return;
          if (lastSeenAt !== null && Date.now() - lastSeenAt < 20_000) return;
          // Une seule relance silencieuse si le navigateur headless disparaît.
          // Après un second échec, on laisse l'erreur visible et attend une action.
          headlessRestarts += 1;
          launchBrowser('headless', true);
        }, 10_000);
        watchdog.unref();
      });

      server.httpServer?.once('close', () => {
        if (watchdog) clearInterval(watchdog);
        stopBrowser();
      });
    },
  };
}
