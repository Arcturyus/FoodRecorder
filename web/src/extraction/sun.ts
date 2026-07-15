/**
 * Extraction d'une exposition au soleil dictée/tapée vers des champs structurés
 * (`SunPatch`). Même logique que l'extraction alimentaire / des pesées : moteur
 * choisi selon `extractionMode`, avec repli sur un parseur à règles.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { SunExposure } from '../sun/vitaminD';
import type { ExtractionMode } from '../store/store';
import { chatWithLlm } from './llm';

/** Sous-ensemble de SunExposure que l'extraction peut renseigner. */
export type SunPatch = Partial<
  Pick<SunExposure, 'date' | 'heure' | 'dureeMin' | 'ciel' | 'peau' | 'phenotype' | 'creme'>
>;

export type SunSource = 'anthropic' | 'claudecode' | 'llm' | 'rules';

function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function systemPrompt(now = new Date()): string {
  const today = localDate(now);
  const weekday = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  return `Tu extrais les détails d'une EXPOSITION AU SOLEIL décrite en français (pour estimer un gain de vitamine D).
La phrase provient d'une transcription vocale : erreurs et homophones possibles. Interprète l'intention.
Aujourd'hui nous sommes le ${today} (${weekday}).
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"date": string, "heure": string, "dureeMin": number, "ciel": string, "peau": string, "phenotype": string, "creme": string}
Règles :
- N'inclus QUE les champs réellement mentionnés. N'invente rien.
- "dureeMin" : durée d'exposition en minutes (« une demi-heure » = 30, « trois quarts d'heure » = 45, « une heure » = 60, « 20 minutes » = 20).
- "heure" au format HH:MM (« ce matin » → "08:00", « fin de matinée » → "11:00", « midi » → "13:00", « après-midi » → "15:00", « fin d'après-midi » → "17:00", « à 15h30 » → "15:30").
- "date" SEULEMENT si un jour est dit (« hier », « avant-hier », « lundi »…), au format YYYY-MM-DD, jamais dans le futur.
- "ciel" ∈ {"tres-ensoleille","ensoleille","voile","nuageux","couvert"} (« grand soleil/plein soleil » = tres-ensoleille, « voilé » = voile, « gris » = couvert).
- "peau" ∈ {"visage-mains","visage-bras","bras-jambes","torse-nu"} (« t-shirt » = visage-bras, « short/jambes » = bras-jambes, « torse nu/maillot » = torse-nu, « habillé » = visage-mains).
- "phenotype" ∈ {"blanc","bronze","mat","noir"} (« peau claire/blanche » = blanc, « bronzé » = bronze, « mate » = mat, « foncée/noire » = noir).
- "creme" ∈ {"aucune","visage","complete"} : "visage" si la crème n'est mise QUE sur le visage (« crème sur le visage », « SPF sur la figure »), "complete" si crème solaire / protection / SPF sur le corps ou sans précision, sinon ne rien mettre.

Exemple :
Entrée : "ce midi je suis resté une demi-heure en plein soleil en short avec de la crème solaire"
Sortie : {"heure":"13:00","dureeMin":30,"ciel":"tres-ensoleille","peau":"bras-jambes","creme":"complete"}`;
}

const sunSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  heure: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  dureeMin: z.number().positive().optional(),
  ciel: z.enum(['tres-ensoleille', 'ensoleille', 'voile', 'nuageux', 'couvert']).optional(),
  peau: z.enum(['visage-mains', 'visage-bras', 'bras-jambes', 'torse-nu']).optional(),
  phenotype: z.enum(['blanc', 'bronze', 'mat', 'noir']).optional(),
  // Tolère l'ancien format booléen (true = crème complète) autant que le nouvel enum.
  creme: z
    .union([z.enum(['aucune', 'visage', 'complete']), z.boolean()])
    .transform((c) => (c === true ? 'complete' : c === false ? 'aucune' : c))
    .optional(),
});

const sunJsonSchema = {
  type: 'object',
  properties: {
    date: { type: 'string' },
    heure: { type: 'string' },
    dureeMin: { type: 'number' },
    ciel: { type: 'string' },
    peau: { type: 'string' },
    phenotype: { type: 'string' },
    creme: { type: 'string' },
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

function validate(raw: unknown): SunPatch | null {
  const parsed = sunSchema.safeParse(raw);
  if (!parsed.success) return null;
  const patch: SunPatch = { ...parsed.data };
  if (patch.date && patch.date > localDate()) delete patch.date;
  return Object.keys(patch).length > 0 ? patch : null;
}

// ---------------------------------------------------------------------------
// Parseur à règles (repli hors-ligne)
// ---------------------------------------------------------------------------

const WEEKDAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Date/heure relatives dictées (heure adaptée au soleil : « midi » ≈ 13 h). */
function parseSunDate(t: string, now = new Date()): Pick<SunPatch, 'date' | 'heure'> {
  const out: Pick<SunPatch, 'date' | 'heure'> = {};
  const at = (daysBack: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);
    return localDate(d);
  };

  if (/\bavant[- ]hier\b/.test(t)) out.date = at(2);
  else if (/\bhier\b/.test(t)) out.date = at(1);
  else {
    const ago = t.match(/il y a (\d+) jours?/);
    if (ago) out.date = at(parseInt(ago[1], 10));
    else {
      for (let i = 0; i < WEEKDAYS_FR.length; i++) {
        if (new RegExp(`\\b${WEEKDAYS_FR[i]}\\b`).test(t)) {
          out.date = at((now.getDay() - i + 7) % 7 || 7);
          break;
        }
      }
    }
  }

  const h = t.match(/\b(?:à\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/);
  if (h && parseInt(h[1], 10) <= 23) out.heure = `${h[1].padStart(2, '0')}:${h[2] ?? '00'}`;
  else if (/fin de matin[ée]e/.test(t)) out.heure = '11:00';
  else if (/fin d'?apr[èe]s[- ]midi|fin d'?aprem/.test(t)) out.heure = '17:00';
  else if (/\bapr[èe]s[- ]midi\b|\baprem\b/.test(t)) out.heure = '15:00';
  else if (/\b(?:ce\s+)?matin\b|au r[ée]veil/.test(t)) out.heure = '08:00';
  else if (/\bmidi\b/.test(t)) out.heure = '13:00';
  else if (/\b(?:en\s+)?d[ée]but d'?apr[èe]s[- ]midi\b/.test(t)) out.heure = '14:00';
  else if (/\b(?:ce\s+|le\s+)?soir\b|fin de journ[ée]e/.test(t)) out.heure = '18:00';

  return out;
}

/** Durée en minutes depuis le texte (chiffres, « demi-heure », « quart d'heure », heures). */
function parseDuration(t: string): number | undefined {
  if (/(?:une\s+)?demi[- ]heure|1\/2\s*h/.test(t)) return 30;
  if (/trois\s+quarts?\s+d'?heure|3\/4\s*h/.test(t)) return 45;
  const min = t.match(/(\d+)\s*(?:min|minutes?)\b/);
  if (min) return parseInt(min[1], 10);
  const hMin = t.match(/(\d+)\s*h(?:eures?)?\s*(\d{1,2})\b/);
  if (hMin) return parseInt(hMin[1], 10) * 60 + parseInt(hMin[2], 10);
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*h(?:eures?)?\b/);
  if (h) return Math.round(parseFloat(h[1].replace(',', '.')) * 60);
  if (/\bune\s+heure\b/.test(t)) return 60;
  return undefined;
}

export function parseSunRules(transcript: string, now = new Date()): SunPatch {
  const t = transcript.toLowerCase();
  const patch: SunPatch = { ...parseSunDate(t, now) };

  const duree = parseDuration(t);
  if (duree != null) patch.dureeMin = duree;

  if (/grand soleil|plein soleil|tr[èe]s ensoleill|cagnard|grand beau/.test(t)) patch.ciel = 'tres-ensoleille';
  else if (/ensoleill|au soleil|beau temps|soleil/.test(t)) patch.ciel = 'ensoleille';
  else if (/voil[ée]/.test(t)) patch.ciel = 'voile';
  else if (/nuageux|nuages?/.test(t)) patch.ciel = 'nuageux';
  else if (/couvert|tr[èe]s gris|ciel gris/.test(t)) patch.ciel = 'couvert';

  if (/torse nu|maillot|en bain|bronzette|topless/.test(t)) patch.peau = 'torse-nu';
  else if (/short|jambes|en cuissard|mollets/.test(t)) patch.peau = 'bras-jambes';
  else if (/t[- ]?shirt|bras|manches courtes|d[ée]bardeur/.test(t)) patch.peau = 'visage-bras';
  else if (/habill[ée]|manteau|pull|visage|mains|couvert de v[êe]tements/.test(t)) patch.peau = 'visage-mains';

  if (/peau claire|peau blanche|teint clair/.test(t)) patch.phenotype = 'blanc';
  else if (/bronz[ée]/.test(t)) patch.phenotype = 'bronze';
  else if (/peau mate|teint mat/.test(t)) patch.phenotype = 'mat';
  else if (/peau fonc[ée]e|peau noire|teint fonc/.test(t)) patch.phenotype = 'noir';

  if (/cr[èe]me solaire|cr[èe]me|protection solaire|[ée]cran total|spf|indice \d+/.test(t)) {
    // « crème sur le visage / la figure » → visage seulement ; sinon crème complète.
    patch.creme = /(?:sur|au|le|du)?\s*(?:visage|figure|front|joues?)/.test(t) ? 'visage' : 'complete';
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Moteurs LLM
// ---------------------------------------------------------------------------

async function extractCloud(transcript: string, apiKey: string, model: string): Promise<SunPatch | null> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const resp = await client.messages.create({
    model,
    max_tokens: 400,
    system: systemPrompt(),
    messages: [{ role: 'user', content: transcript }],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return validate(extractJson(text));
}

async function extractBridge(transcript: string): Promise<SunPatch | null> {
  const res = await fetch('/api/claude-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${systemPrompt()}\n\nPhrase : "${transcript}"\nJSON :` }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return validate(extractJson(data.text ?? ''));
}

async function extractLocal(transcript: string): Promise<SunPatch | null> {
  const content = await chatWithLlm(systemPrompt(), transcript, { schema: sunJsonSchema, maxTokens: 350 });
  return content ? validate(extractJson(content)) : null;
}

/**
 * Point d'entrée unifié. Choisit le moteur selon `mode`, et retombe TOUJOURS sur
 * le parseur à règles si le LLM échoue ou ne renvoie rien d'exploitable.
 */
export async function extractSun(
  transcript: string,
  mode: ExtractionMode,
  apiKey: string,
  cloudModel: string,
): Promise<{ patch: SunPatch; source: SunSource }> {
  const clean = transcript.trim();
  if (!clean) return { patch: {}, source: 'rules' };

  // Le parseur complète les champs que le LLM aurait oubliés (date/heure notamment).
  const withRules = (patch: SunPatch): SunPatch => ({ ...parseSunRules(clean), ...patch });

  try {
    if (mode === 'cloud' && apiKey) {
      const patch = await extractCloud(clean, apiKey, cloudModel);
      if (patch) return { patch: withRules(patch), source: 'anthropic' };
    } else if (mode === 'claudecode') {
      const patch = await extractBridge(clean);
      if (patch) return { patch: withRules(patch), source: 'claudecode' };
    } else if (mode === 'local') {
      const patch = await extractLocal(clean);
      if (patch) return { patch: withRules(patch), source: 'llm' };
    }
  } catch (e) {
    if (e instanceof Anthropic.APIError) throw new Error(`API Claude : ${e.message}`);
    if (mode === 'claudecode') throw e instanceof Error ? new Error(`Pont Claude Code : ${e.message}`) : e;
  }

  return { patch: parseSunRules(clean), source: 'rules' };
}
