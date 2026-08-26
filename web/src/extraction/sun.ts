/**
 * Extraction d'une exposition au soleil dictée/tapée vers des champs structurés
 * (`SunPatch`). Même logique que l'extraction alimentaire / des pesées : moteur
 * choisi selon `extractionMode`, avec repli sur un parseur à règles.
 */

import { z } from 'zod';
import type { SunExposure } from '../sun/vitaminD';
import type { ExtractionMode } from '../store/store';
import { askCloud } from './cloud';
import type { CloudConfig, ExtractionSource } from './providers';
import { callBridge } from './bridge';
import { chatWithLlm } from './llm';

/** Sous-ensemble de SunExposure que l'extraction peut renseigner. */
export type SunPatch = Partial<
  Pick<SunExposure, 'date' | 'heure' | 'dureeMin' | 'ciel' | 'peau' | 'phenotype' | 'creme'>
>;

export type SunSource = ExtractionSource;

function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function systemPrompt(now = new Date()): string {
  const today = localDate(now);
  const weekday = now.toLocaleDateString('fr-FR', { weekday: 'long' });
  return `Tu extrais les EXPOSITIONS AU SOLEIL décrites en français (pour estimer un gain de vitamine D).
La phrase provient d'une transcription vocale : erreurs et homophones possibles. Interprète l'intention.
Aujourd'hui nous sommes le ${today} (${weekday}).
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"sorties": [{"date": string, "heure": string, "dureeMin": number, "ciel": string, "peau": string, "phenotype": string, "creme": string}]}
Une phrase peut décrire PLUSIEURS sorties : renvoie un élément par sortie, dans l'ordre chronologique.
Règles sur chaque sortie :
- N'inclus QUE les champs réellement mentionnés. N'invente rien.
- "dureeMin" : durée d'exposition RÉELLE AU SOLEIL en minutes (« une demi-heure » = 30, « trois quarts d'heure » = 45, « une heure » = 60, « 20 minutes » = 20).
- "heure" au format HH:MM (« ce matin » → "08:00", « fin de matinée » → "11:00", « midi » → "13:00", « après-midi » → "15:00", « fin d'après-midi » → "17:00", « à 15h30 » → "15:30").
- "date" SEULEMENT si un jour est dit (« hier », « avant-hier », « lundi »…), au format YYYY-MM-DD, jamais dans le futur.
- "ciel" ∈ {"tres-ensoleille","ensoleille","voile","nuageux","couvert"} (« grand soleil/plein soleil » = tres-ensoleille, « voilé » = voile, « gris » = couvert).
- "peau" ∈ {"visage-mains","visage-bras","bras-jambes","torse-nu"} (« t-shirt » = visage-bras, « short/jambes » = bras-jambes, « torse nu/maillot » = torse-nu, « habillé » = visage-mains).
- "phenotype" ∈ {"blanc","bronze","mat","noir"} (« peau claire/blanche » = blanc, « bronzé » = bronze, « mate » = mat, « foncée/noire » = noir).
- "creme" ∈ {"aucune","visage","complete"} : "visage" si la crème n'est mise QUE sur le visage (« crème sur le visage », « SPF sur la figure »), "complete" si crème solaire / protection / SPF sur le corps ou sans précision, sinon ne rien mettre.

TEMPS PASSÉ À L'INTÉRIEUR / À L'OMBRE — RÈGLE ESSENTIELLE :
Seul le temps réellement AU SOLEIL compte. Ne compte JAMAIS la durée totale d'une sortie ou d'une journée : déduis-en le temps passé dedans, à l'ombre, en voiture ou couvert.
- Une journée surtout en intérieur, entrecoupée de courtes sorties (« j'étais dans un musée mais je suis sorti 5 minutes plusieurs fois »), ne donne PAS une longue exposition : regroupe ces passages en une seule sortie dont "dureeMin" est la somme des minutes de soleil, placée à l'heure médiane — sauf s'ils sont clairement à des moments distincts de la journée (matin ET après-midi), auquel cas fais-en une sortie par moment.
- Si la personne donne une durée totale ET une proportion (« 3 h dehors mais les trois quarts à l'ombre »), ne retiens que la part au soleil (ici 45).
- Dans le doute sur le temps réellement exposé, sois CONSERVATEUR (durée basse) : mieux vaut sous-estimer un gain que l'inventer.

Exemple (une sortie) :
Entrée : "ce midi je suis resté une demi-heure en plein soleil en short avec de la crème solaire"
Sortie : {"sorties":[{"heure":"13:00","dureeMin":30,"ciel":"tres-ensoleille","peau":"bras-jambes","creme":"complete"}]}

Exemple (deux sorties dans une phrase) :
Entrée : "je suis sorti vingt minutes ce matin en t-shirt et une demi-heure à 17h en short"
Sortie : {"sorties":[{"heure":"08:00","dureeMin":20,"peau":"visage-bras"},{"heure":"17:00","dureeMin":30,"peau":"bras-jambes"}]}

Exemple (intérieur entrecoupé de courtes sorties) :
Entrée : "j'ai passé l'après-midi à l'intérieur mais je suis sorti fumer genre cinq minutes six fois en t-shirt il faisait grand soleil"
Raisonnement : l'après-midi entier n'est PAS une exposition ; seules les pauses comptent : 6 × 5 min = 30 min de soleil, regroupées à l'heure médiane de l'après-midi.
Sortie : {"sorties":[{"heure":"15:00","dureeMin":30,"ciel":"tres-ensoleille","peau":"visage-bras"}]}

Exemple (durée totale ≠ durée au soleil) :
Entrée : "j'ai randonné trois heures ce matin mais c'était en forêt, à peine vingt minutes en plein cagnard"
Sortie : {"sorties":[{"heure":"08:00","dureeMin":20,"ciel":"tres-ensoleille"}]}`;
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

/** Réponse attendue : { sorties: [...] }. */
const sunResponseSchema = z.object({ sorties: z.array(sunSchema) });

const sunJsonSchema = {
  type: 'object',
  properties: {
    sorties: {
      type: 'array',
      items: {
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
      },
    },
  },
  required: ['sorties'],
  additionalProperties: false,
} as const;

/**
 * Extrait le premier JSON d'une réponse texte — objet `{…}` (format demandé) ou
 * tableau `[…]` (écart fréquent des petits modèles, cf. `validate`).
 */
function extractJson(text: string): unknown | null {
  const candidates: [number, number][] = [
    [text.indexOf('{'), text.lastIndexOf('}')],
    [text.indexOf('['), text.lastIndexOf(']')],
  ];
  // Le plus englobant d'abord : un tableau de sorties commence avant son 1er objet.
  candidates.sort((a, b) => a[0] - b[0]);
  for (const [start, end] of candidates) {
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // format suivant
    }
  }
  return null;
}

/** Nettoie une sortie : pas de date future, et au moins un champ utile. */
function validateOne(raw: unknown): SunPatch | null {
  const parsed = sunSchema.safeParse(raw);
  if (!parsed.success) return null;
  const patch: SunPatch = { ...parsed.data };
  if (patch.date && patch.date > localDate()) delete patch.date;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Valide la réponse d'un LLM. Accepte `{sorties:[…]}` (format demandé), mais
 * tolère aussi un objet de sortie nu ou un tableau nu : les petits modèles
 * ignorent régulièrement l'enveloppe, et une dictée comprise vaut mieux qu'un
 * repli sur le parseur à règles.
 */
function validate(raw: unknown): SunPatch[] | null {
  const wrapped = sunResponseSchema.safeParse(raw);
  const list: unknown[] = wrapped.success
    ? wrapped.data.sorties
    : Array.isArray(raw)
      ? raw
      : raw != null && typeof raw === 'object'
        ? [raw]
        : [];
  const sorties = list.map(validateOne).filter((p): p is SunPatch => p !== null);
  return sorties.length > 0 ? sorties : null;
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

/**
 * Nombres écrits en toutes lettres : une dictée dit « vingt minutes » bien plus
 * souvent que « 20 minutes », et la durée est le facteur le plus sensible du
 * calcul — la rater silencieusement fausse tout le gain estimé.
 */
const NUMBER_WORDS: Record<string, number> = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
  'dix-sept': 17, 'dix sept': 17, 'dix-huit': 18, 'dix huit': 18, 'dix-neuf': 19, 'dix neuf': 19,
  'vingt-cinq': 25, 'vingt cinq': 25, 'quatre-vingt': 80, 'quatre vingt': 80, 'quatre-vingt-dix': 90,
};

/** Motif alterné des nombres en lettres, les plus longs d'abord (« dix-sept » avant « dix »). */
const NUMBER_WORDS_RE = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Durée en minutes depuis le texte (chiffres, nombres en lettres, « demi-heure »…). */
function parseDuration(t: string): number | undefined {
  if (/(?:une\s+)?demi[- ]heure|1\/2\s*h/.test(t)) return 30;
  if (/trois\s+quarts?\s+d'?heure|3\/4\s*h/.test(t)) return 45;
  if (/(?:un\s+)?quart\s+d'?heure/.test(t)) return 15;
  const min = t.match(/(\d+)\s*(?:min|minutes?)\b/);
  if (min) return parseInt(min[1], 10);
  const minWord = t.match(new RegExp(`\\b(${NUMBER_WORDS_RE})\\s*(?:min|minutes?)\\b`));
  if (minWord) return NUMBER_WORDS[minWord[1]];
  const hMin = t.match(/(\d+)\s*h(?:eures?)?\s*(\d{1,2})\b/);
  if (hMin) return parseInt(hMin[1], 10) * 60 + parseInt(hMin[2], 10);
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*h(?:eures?)?\b/);
  if (h) return Math.round(parseFloat(h[1].replace(',', '.')) * 60);
  const hWord = t.match(new RegExp(`\\b(${NUMBER_WORDS_RE})\\s*h(?:eures?)?\\b`));
  if (hWord) return NUMBER_WORDS[hWord[1]] * 60;
  return undefined;
}

export function parseSunRules(transcript: string, now = new Date()): SunPatch {
  // Les moteurs de dictée produisent l'apostrophe typographique (« d’heure ») ;
  // toutes les règles ci-dessous s'écrivent avec l'apostrophe droite.
  const t = transcript.toLowerCase().replace(/[’‘`]/g, "'");
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

async function extractCloud(transcript: string, cloud: CloudConfig): Promise<SunPatch[] | null> {
  const text = await askCloud(systemPrompt(), transcript, cloud, { maxTokens: 400 });
  return validate(extractJson(text));
}

async function extractBridge(transcript: string): Promise<SunPatch[] | null> {
  const text = await callBridge({ prompt: `${systemPrompt()}\n\nPhrase : "${transcript}"\nJSON :`, label: 'soleil' });
  return validate(extractJson(text));
}

async function extractLocal(transcript: string): Promise<SunPatch[] | null> {
  const content = await chatWithLlm(systemPrompt(), transcript, { schema: sunJsonSchema, maxTokens: 600 });
  return content ? validate(extractJson(content)) : null;
}

/**
 * Point d'entrée unifié. Choisit le moteur selon `mode`, et retombe TOUJOURS sur
 * le parseur à règles si le LLM échoue ou ne renvoie rien d'exploitable.
 * Retourne UNE sortie par exposition décrite (une phrase peut en contenir
 * plusieurs) ; `sorties` est vide si rien n'a été compris.
 */
export async function extractSun(
  transcript: string,
  mode: ExtractionMode,
  cloud: CloudConfig,
): Promise<{ sorties: SunPatch[]; source: SunSource }> {
  const clean = transcript.trim();
  if (!clean) return { sorties: [], source: 'rules' };

  /**
   * Le parseur à règles complète les champs que le LLM aurait oubliés (date et
   * heure notamment). Il ne voit qu'une sortie : ses valeurs ne servent donc que
   * de fond commun, chaque sortie du LLM gardant les siennes. Quand le LLM en
   * renvoie plusieurs, on n'applique pas l'heure des règles (elle vaudrait pour
   * la première sortie et fausserait les suivantes).
   */
  const rules = parseSunRules(clean);
  const withRules = (sorties: SunPatch[]): SunPatch[] => {
    const common: SunPatch = sorties.length > 1 ? { ...rules, heure: undefined, dureeMin: undefined } : rules;
    return sorties.map((p) => {
      const merged: SunPatch = { ...common, ...p };
      // `undefined` explicite (cf. `common`) ne doit pas rester dans le patch.
      for (const k of Object.keys(merged) as (keyof SunPatch)[]) if (merged[k] === undefined) delete merged[k];
      return merged;
    });
  };

  try {
    if (mode === 'cloud' && cloud.apiKey) {
      const sorties = await extractCloud(clean, cloud);
      if (sorties) return { sorties: withRules(sorties), source: cloud.provider };
    } else if (mode === 'claudecode') {
      const sorties = await extractBridge(clean);
      if (sorties) return { sorties: withRules(sorties), source: 'claudecode' };
    } else if (mode === 'local') {
      const sorties = await extractLocal(clean);
      if (sorties) return { sorties: withRules(sorties), source: 'llm' };
    }
  } catch (e) {
    // Les erreurs d'API arrivent déjà nommées et lisibles (cf. cloud.ts).
    if (mode === 'cloud') throw e;
    if (mode === 'claudecode') throw e instanceof Error ? new Error(`Pont CLI : ${e.message}`) : e;
  }

  return { sorties: Object.keys(rules).length > 0 ? [rules] : [], source: 'rules' };
}
