/**
 * Relecture d'un aliment de ma banque par une IA forte, sous forme de discussion.
 *
 * La banque se remplit désormais toute seule : chaque aliment hors catalogue est
 * né d'une estimation, jamais relue. Plutôt que de corriger 39 nutriments à la
 * main, on demande son avis à l'IA — et surtout on peut lui RÉPONDRE : « je
 * pensais qu'il y avait plus de protéines », « les miennes sont à l'huile ».
 * D'où l'historique : sans lui, chaque objection repartirait de zéro et l'IA
 * redonnerait la même réponse.
 *
 * « Revoir cet aliment » et le chat sont la MÊME opération : le bouton n'est que
 * le premier tour, sans message de l'utilisateur.
 *
 * C'est le seul appel de l'app qui soit multi-tours. L'API Claude prend
 * l'historique nativement ; le pont Claude Code n'accepte qu'un prompt unique,
 * on le lui aplatit en texte.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import type { Food, FoodCategory, NutrientKey, Nutrients } from '../nutrition/types';
import { nutrientLabelOf } from '../nutrition/rda';
import type { ExtractionMode } from '../store/store';
import { NUTRIMENTS_PROMPT_DOC } from './schema';

const NUTRIENT_KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

const CATEGORIES = [
  'fruit', 'legume', 'feculent', 'viande', 'poisson', 'oeuf-laitier',
  'sucre-snack', 'matiere-grasse', 'boisson', 'plat', 'supplement', 'autre',
] as const;

const nutrimentsSchema = z.object(
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, z.number().nonnegative().optional()])),
) as z.ZodType<Partial<Record<NutrientKey, number>>>;

const reviewSchema = z.object({
  reponse: z.string().min(1),
  fiche: z
    .object({
      categorie: z.enum(CATEGORIES).optional(),
      grammesParPiece: z.number().positive().optional(),
      nutriments: nutrimentsSchema,
    })
    .nullable()
    .optional(),
});

/** Un tour de la discussion. `fiche` : valeurs proposées par l'IA à ce tour. */
export interface ReviewTurn {
  role: 'user' | 'assistant';
  text: string;
  fiche?: ReviewFiche;
}

export interface ReviewFiche {
  nutriments: Nutrients;
  categorie?: FoodCategory;
  grammesParPiece?: number;
}

/** Contexte de consommation : ce que l'utilisateur mange VRAIMENT de cet aliment. */
export interface ReviewUsage {
  jours: number;
  occurrences: number;
  /** Quantité moyenne réellement consommée, en grammes. */
  grammesMoyens: number;
}

const SYSTEM_PROMPT = `Tu relis la fiche nutritionnelle d'un aliment, dans une application de suivi alimentaire personnel.

Ces fiches viennent souvent d'une estimation faite au vol par une IA à partir d'une phrase dictée : elles peuvent être approximatives, mal catégorisées, ou décrire une préparation différente de celle réellement mangée. Ton rôle est de dire si les valeurs sont plausibles, et de proposer mieux quand ce n'est pas le cas.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"reponse": string, "fiche": {"categorie": string, "grammesParPiece": number, "nutriments": {…}} | null}

- "reponse" : 1 à 4 phrases en français, adressées à l'utilisateur. Explique ton raisonnement et cite les ordres de grandeur qui te font trancher. Pas de formule de politesse, pas de Markdown.
- "fiche" : null si les valeurs actuelles te paraissent correctes — c'est un cas NORMAL et fréquent, ne propose pas un changement pour justifier ta présence. Sinon, la fiche corrigée COMPLÈTE.
- Quand tu proposes une fiche, "nutriments" doit contenir TOUS les champs (n'en omets AUCUN ; mets 0 si négligeable), même ceux que tu ne changes pas.
- "grammesParPiece" : uniquement si l'aliment se compte en pièces/portions.

RÉPONDRE À L'UTILISATEUR :
- S'il conteste une valeur, ne cède pas par politesse. S'il a raison, corrige ; s'il a tort, dis-le clairement en expliquant pourquoi, et renvoie "fiche": null.
- S'il apporte une information nouvelle sur SA préparation (« les miennes sont à l'huile », « je les fais sans matière grasse »), c'est décisif : elle l'emporte sur la valeur générique, et tu proposes alors une fiche adaptée.
- Le nom de l'aliment reste celui de l'utilisateur : ne le renomme pas.

${NUTRIMENTS_PROMPT_DOC}`;

/** Les macros suffisent à situer une fiche : inutile de citer 39 valeurs. */
const RESUME_KEYS: NutrientKey[] = ['kcal', 'proteines', 'glucides', 'lipides', 'fibres', 'agSatures'];

/** Résumé lisible d'une fiche (pour l'historique renvoyé à l'IA). */
function resumeFiche(f: ReviewFiche): string {
  return RESUME_KEYS.map((k) => `${nutrientLabelOf(k)} ${f.nutriments[k] ?? 0}`).join(', ');
}

/** Description de l'aliment relu, avec ses valeurs actuelles et son usage réel. */
function describeFood(food: Food, usage?: ReviewUsage): string {
  const lignes = NUTRIENT_KEYS.filter((k) => (food.n[k] ?? 0) !== 0)
    .map((k) => `${k}=${food.n[k]}`)
    .join(', ');
  const parts = [
    `Aliment : « ${food.nom} »`,
    `Catégorie actuelle : ${food.categorie}`,
    food.pieceGrams ? `Poids d'une pièce : ${food.pieceGrams} g` : null,
    `Valeurs actuelles pour 100 g (les champs à 0 sont omis) : ${lignes || 'aucune'}`,
  ];
  if (usage && usage.occurrences > 0) {
    parts.push(
      `Consommation réelle de l'utilisateur : ${usage.occurrences} fois sur ${usage.jours} jour(s), ` +
        `portion moyenne ${Math.round(usage.grammesMoyens)} g.`,
    );
  }
  return parts.filter(Boolean).join('\n');
}

/** Extrait le premier objet JSON d'une réponse texte. */
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

/** Premier message : la fiche à relire. Les suivants : les objections de l'utilisateur. */
function firstUserMessage(food: Food, usage?: ReviewUsage): string {
  return `${describeFood(food, usage)}\n\nCes valeurs sont-elles cohérentes ?\nJSON :`;
}

/** Historique → messages de l'API Claude. */
function toMessages(food: Food, usage: ReviewUsage | undefined, history: ReviewTurn[]): Anthropic.MessageParam[] {
  const msgs: Anthropic.MessageParam[] = [{ role: 'user', content: firstUserMessage(food, usage) }];
  for (const t of history) {
    if (t.role === 'assistant') {
      msgs.push({
        role: 'assistant',
        content: t.fiche ? `${t.text}\n(fiche proposée : ${resumeFiche(t.fiche)})` : t.text,
      });
    } else {
      msgs.push({ role: 'user', content: `${t.text}\nJSON :` });
    }
  }
  return msgs;
}

/** Même conversation, aplatie en un seul prompt pour le pont Claude Code. */
function toFlatPrompt(food: Food, usage: ReviewUsage | undefined, history: ReviewTurn[]): string {
  const lignes = [SYSTEM_PROMPT, '', firstUserMessage(food, usage)];
  for (const t of history) {
    if (t.role === 'assistant') {
      lignes.push('', `Ta réponse précédente : ${t.text}`);
      if (t.fiche) lignes.push(`(fiche que tu avais proposée : ${resumeFiche(t.fiche)})`);
    } else {
      lignes.push('', `L'utilisateur répond : ${t.text}`, 'JSON :');
    }
  }
  return lignes.join('\n');
}

/**
 * La relecture est nettement plus lourde que les autres appels du pont (prompt
 * système long, fiche de 39 valeurs à produire) : le délai par défaut de 60 s
 * est systématiquement dépassé. L'utilisateur vient de cliquer « demander à
 * l'IA », il accepte d'attendre — contrairement à la saisie d'un repas.
 */
const RELECTURE_TIMEOUT_MS = 180_000;

async function askBridge(prompt: string): Promise<string> {
  const res = await fetch('/api/claude-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, label: 'relecture', timeoutMs: RELECTURE_TIMEOUT_MS }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.text ?? '';
}

async function askCloud(messages: Anthropic.MessageParam[], apiKey: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const resp = await client.messages.create({ model, max_tokens: 2048, system: SYSTEM_PROMPT, messages });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Demande à l'IA de relire un aliment. `history` vide = première relecture ;
 * sinon il porte les tours précédents, objections de l'utilisateur comprises.
 * Lève si l'IA n'est pas joignable : il n'y a pas de repli utile (contrairement
 * à l'extraction, où le matching prend le relais).
 */
export async function reviewFood(
  food: Food,
  usage: ReviewUsage | undefined,
  history: ReviewTurn[],
  mode: ExtractionMode,
  apiKey: string,
  cloudModel: string,
): Promise<ReviewTurn> {
  if (mode !== 'cloud' && mode !== 'claudecode') {
    throw new Error('La relecture demande une IA forte (Claude Code ou API Claude) — voir Réglages.');
  }
  if (mode === 'cloud' && !apiKey) throw new Error('Clé API manquante — voir Réglages.');

  const text =
    mode === 'cloud'
      ? await askCloud(toMessages(food, usage, history), apiKey, cloudModel)
      : await askBridge(toFlatPrompt(food, usage, history));

  const parsed = reviewSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new Error('Réponse de l’IA illisible.');

  const { reponse, fiche } = parsed.data;
  return {
    role: 'assistant',
    text: reponse,
    ...(fiche
      ? {
          fiche: {
            nutriments: { ...EMPTY_NUTRIENTS, ...fiche.nutriments },
            ...(fiche.categorie ? { categorie: fiche.categorie } : {}),
            ...(fiche.grammesParPiece ? { grammesParPiece: fiche.grammesParPiece } : {}),
          },
        }
      : {}),
  };
}

/** Nutriments dont la valeur change assez pour mériter une ligne de diff. */
export interface FicheDiff {
  key: NutrientKey;
  label: string;
  avant: number;
  apres: number;
}

/**
 * Écarts entre la fiche proposée et l'aliment actuel. On ignore le bruit sous
 * 1 % (l'IA réécrit les 39 valeurs à chaque fois, la plupart à l'identique à un
 * arrondi près) : sans ce filtre, le diff serait illisible.
 */
export function ficheDiff(food: Food, fiche: ReviewFiche): FicheDiff[] {
  const out: FicheDiff[] = [];
  for (const key of NUTRIENT_KEYS) {
    const avant = food.n[key] ?? 0;
    const apres = fiche.nutriments[key] ?? 0;
    const seuil = Math.max(Math.abs(avant) * 0.01, 1e-6);
    if (Math.abs(apres - avant) <= seuil) continue;
    out.push({ key, label: nutrientLabelOf(key), avant, apres });
  }
  return out;
}
