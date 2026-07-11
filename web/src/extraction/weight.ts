/**
 * Extraction d'une pesée dictée/tapée vers des champs structurés
 * (`Partial<WeightEntry>`). Même logique que l'extraction alimentaire : on
 * choisit le moteur selon `extractionMode`, avec repli sur un parseur à règles
 * (regex) si le LLM échoue ou n'est pas disponible.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { WeightEntry } from '../weight/types';
import type { ExtractionMode } from '../store/store';
import { chatWithLlm } from './llm';

/** Sous-ensemble de WeightEntry que l'extraction peut renseigner. */
export type WeightPatch = Partial<
  Pick<
    WeightEntry,
    | 'poids'
    | 'masseGrasse'
    | 'eau'
    | 'masseMusculaire'
    | 'masseOsseuse'
    | 'graisseViscerale'
    | 'metabolismeBasalMachine'
    | 'aJeun'
    | 'nu'
    | 'date'
    | 'heure'
    | 'remarque'
  >
>;

export type WeightSource = 'anthropic' | 'claudecode' | 'llm' | 'rules';

/** Date locale YYYY-MM-DD (dupliquée du store pour éviter un import circulaire). */
function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Prompt système, reconstruit à chaque appel pour injecter la date du jour. */
function systemPrompt(now = new Date()): string {
  const today = localDate(now);
  const weekday = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  return `Tu extrais les mesures d'une PESÉE sur balance connectée, dictée en français.
La phrase provient d'une transcription vocale : elle peut contenir des erreurs, homophones, hésitations. Interprète l'intention.
Aujourd'hui nous sommes le ${today} (${weekday}).
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"poids": number, "masseGrasse": number, "eau": number, "masseMusculaire": number, "masseOsseuse": number, "graisseViscerale": number, "metabolismeBasalMachine": number, "aJeun": boolean, "nu": boolean, "date": string, "heure": string, "remarque": string}
Règles :
- N'inclus QUE les champs réellement mentionnés. N'invente aucune valeur.
- "poids" et "masseOsseuse" sont en kg ; "masseGrasse", "eau", "masseMusculaire" en pourcentage ; "graisseViscerale" est un indice sans unité ; "metabolismeBasalMachine" en kcal.
- Un nombre seul en début de phrase est le poids (ex. « soixante-huit cinq » = 68,5 kg).
- "aJeun"/"nu" : true seulement si explicitement dit (« à jeun », « nu », « habillé » → nu:false).
- "date" : SEULEMENT si un jour est mentionné (« hier », « avant-hier », « lundi », « le 5 juillet »…), au format YYYY-MM-DD, calculé par rapport à aujourd'hui (jamais dans le futur : « lundi » = le lundi passé le plus proche). Si aucun jour n'est dit, omets le champ.
- "heure" : SEULEMENT si un moment est mentionné, au format HH:MM (« ce matin »/« au réveil » → "08:00", « midi » → "12:00", « ce soir » → "20:00", « à 7h30 » → "07:30").
- "remarque" : toute note qualitative (« après le sport », « malade »…), sinon omets le champ.

Exemple :
Entrée : "hier matin soixante-huit kilos cinq, masse grasse dix-huit virgule deux, à jeun, note reprise du sport"
Sortie : {"poids":68.5,"masseGrasse":18.2,"aJeun":true,"date":"${localDate(new Date(now.getTime() - 86_400_000))}","heure":"08:00","remarque":"reprise du sport"}`;
}

const weightSchema = z.object({
  poids: z.number().positive().optional(),
  masseGrasse: z.number().nonnegative().optional(),
  eau: z.number().nonnegative().optional(),
  masseMusculaire: z.number().nonnegative().optional(),
  masseOsseuse: z.number().nonnegative().optional(),
  graisseViscerale: z.number().nonnegative().optional(),
  metabolismeBasalMachine: z.number().nonnegative().optional(),
  aJeun: z.boolean().optional(),
  nu: z.boolean().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  heure: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  remarque: z.string().optional(),
});

/** JSON Schema pour le décodage contraint de WebLLM. */
const weightJsonSchema = {
  type: 'object',
  properties: {
    poids: { type: 'number' },
    masseGrasse: { type: 'number' },
    eau: { type: 'number' },
    masseMusculaire: { type: 'number' },
    masseOsseuse: { type: 'number' },
    graisseViscerale: { type: 'number' },
    metabolismeBasalMachine: { type: 'number' },
    aJeun: { type: 'boolean' },
    nu: { type: 'boolean' },
    date: { type: 'string' },
    heure: { type: 'string' },
    remarque: { type: 'string' },
  },
  additionalProperties: false,
} as const;

function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function validate(raw: unknown): WeightPatch | null {
  const parsed = weightSchema.safeParse(raw);
  if (!parsed.success) return null;
  const patch: WeightPatch = { ...parsed.data };
  // Garde-fou : jamais de pesée dans le futur (LLM qui calcule mal un jour relatif).
  if (patch.date && patch.date > localDate()) delete patch.date;
  // Vide (aucun champ) → considéré comme échec pour déclencher le repli.
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------------------------------------------------------------------
// Parseur à règles (repli hors-ligne)
// ---------------------------------------------------------------------------

/** Extrait le premier nombre FR après un motif (virgule ou point décimal). */
function findNumber(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  if (!m) return undefined;
  const n = parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

const NUM = '(\\d+(?:[.,]\\d+)?)';

/** Jours de la semaine (getDay() : dimanche = 0). */
const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/**
 * Date/heure relatives dictées : « hier », « avant-hier », « il y a 3 jours »,
 * « lundi (dernier) », « ce matin », « hier soir », « à 7h30 »…
 * Retourne uniquement les champs réellement mentionnés (comme le LLM).
 */
export function parseWeightDate(transcript: string, now = new Date()): Pick<WeightPatch, 'date' | 'heure'> {
  const t = transcript.toLowerCase();
  const out: Pick<WeightPatch, 'date' | 'heure'> = {};

  const at = (daysBack: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);
    return localDate(d);
  };

  if (/\bavant[- ]hier\b/.test(t)) out.date = at(2);
  else if (/\bhier\b/.test(t)) out.date = at(1);
  else if (/\baujourd'?hui\b/.test(t)) out.date = at(0);
  else {
    const ago = t.match(/il y a (\d+) jours?/);
    if (ago) out.date = at(parseInt(ago[1], 10));
    else {
      // « lundi », « mardi dernier »… = le jour passé le plus proche (jamais le futur)
      for (let i = 0; i < WEEKDAYS_FR.length; i++) {
        if (new RegExp(`\\b${WEEKDAYS_FR[i]}\\b`).test(t)) {
          const back = (now.getDay() - i + 7) % 7 || 7; // aujourd'hui → il y a 7 jours
          out.date = at(back);
          break;
        }
      }
    }
  }

  // heure explicite (« à 7h30 », « 7 h », « 07:30 ») puis moments de la journée
  const h = t.match(/\b(?:à\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/);
  if (h && parseInt(h[1], 10) <= 23) {
    out.heure = `${h[1].padStart(2, '0')}:${h[2] ?? '00'}`;
  } else if (/\b(?:ce\s+)?matin\b|\bau réveil\b|\bau lever\b/.test(t)) out.heure = '08:00';
  else if (/\bmidi\b/.test(t)) out.heure = '12:00';
  else if (/\b(?:ce\s+|le\s+)?soir\b/.test(t)) out.heure = '20:00';

  return out;
}

export function parseWeightRules(transcript: string): WeightPatch {
  const t = transcript.toLowerCase();
  const patch: WeightPatch = { ...parseWeightDate(transcript) };

  const poids =
    findNumber(t, new RegExp(`${NUM}\\s*(?:kg|kilos?|kilogrammes?)`, 'i')) ??
    findNumber(t, new RegExp(`(?:poids|pesé|pese|je fais)\\D{0,6}${NUM}`, 'i')) ??
    findNumber(t, new RegExp(`^\\D{0,3}${NUM}`, 'i'));
  if (poids != null) patch.poids = poids;

  const mg = findNumber(t, new RegExp(`(?:masse\\s*grasse|graisse|gras)\\D{0,8}${NUM}`, 'i'));
  if (mg != null) patch.masseGrasse = mg;
  const eau = findNumber(t, new RegExp(`eau\\D{0,8}${NUM}`, 'i'));
  if (eau != null) patch.eau = eau;
  const mm = findNumber(t, new RegExp(`(?:masse\\s*musculaire|muscle)\\D{0,8}${NUM}`, 'i'));
  if (mm != null) patch.masseMusculaire = mm;
  const mo = findNumber(t, new RegExp(`(?:masse\\s*osseuse|os)\\D{0,8}${NUM}`, 'i'));
  if (mo != null) patch.masseOsseuse = mo;
  const gv = findNumber(t, new RegExp(`visc[ée]rale?\\D{0,8}${NUM}`, 'i'));
  if (gv != null) patch.graisseViscerale = gv;
  const meta = findNumber(t, new RegExp(`(?:m[ée]tabolisme|basal)\\D{0,8}${NUM}`, 'i'));
  if (meta != null) patch.metabolismeBasalMachine = meta;

  // pas de \b avant « à » : les lettres accentuées ne sont pas des caractères « mot » en regex JS
  if (/[aà]\s*jeun\b/i.test(t)) patch.aJeun = true;
  if (/\bnu\b/i.test(t)) patch.nu = true;
  if (/\bhabill[ée]/i.test(t)) patch.nu = false;

  return patch;
}

// ---------------------------------------------------------------------------
// Moteurs LLM
// ---------------------------------------------------------------------------

async function extractCloud(transcript: string, apiKey: string, model: string): Promise<WeightPatch | null> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const resp = await client.messages.create({
    model,
    max_tokens: 512,
    system: systemPrompt(),
    messages: [{ role: 'user', content: transcript }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return validate(extractJson(text));
}

async function extractBridge(transcript: string): Promise<WeightPatch | null> {
  const res = await fetch('/api/claude-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${systemPrompt()}\n\nPhrase : "${transcript}"\nJSON :` }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return validate(extractJson(data.text ?? ''));
}

async function extractLocal(transcript: string): Promise<WeightPatch | null> {
  const content = await chatWithLlm(systemPrompt(), transcript, { schema: weightJsonSchema, maxTokens: 400 });
  return content ? validate(extractJson(content)) : null;
}

/**
 * Point d'entrée unifié. Choisit le moteur selon `mode`, et retombe TOUJOURS sur
 * le parseur à règles si le LLM échoue ou ne renvoie rien d'exploitable.
 * Les erreurs d'API (clé, réseau) sont remontées pour l'affichage.
 */
export async function extractWeight(
  transcript: string,
  mode: ExtractionMode,
  apiKey: string,
  cloudModel: string,
): Promise<{ patch: WeightPatch; source: WeightSource }> {
  const clean = transcript.trim();
  if (!clean) return { patch: {}, source: 'rules' };

  // Si le LLM omet la date/heure dictée (« hier matin »), le parseur la complète.
  const withDate = (patch: WeightPatch): WeightPatch => ({ ...parseWeightDate(clean), ...patch });

  try {
    if (mode === 'cloud' && apiKey) {
      const patch = await extractCloud(clean, apiKey, cloudModel);
      if (patch) return { patch: withDate(patch), source: 'anthropic' };
    } else if (mode === 'claudecode') {
      const patch = await extractBridge(clean);
      if (patch) return { patch: withDate(patch), source: 'claudecode' };
    } else if (mode === 'local') {
      const patch = await extractLocal(clean);
      if (patch) return { patch: withDate(patch), source: 'llm' };
    }
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new Error(`API Claude : ${e.message}`);
    if (mode === 'claudecode') throw e instanceof Error ? new Error(`Pont Claude Code : ${e.message}`) : e;
    // IA locale indisponible → repli silencieux sur les règles.
  }

  return { patch: parseWeightRules(clean), source: 'rules' };
}
