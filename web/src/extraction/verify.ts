/**
 * 2e passe des IA fortes sur le matching : l'IA a le dernier mot.
 *
 * L'app résout les aliments par similarité de texte (`matchFood`). Ce matching
 * ne « comprend » rien : « tarte à la myrtille » ressemble à « Myrtille », et
 * l'app servirait alors les valeurs du fruit pour une part de tarte.
 *
 * Quand le match n'est PAS quasi exact, on renvoie donc à l'IA forte (API Claude
 * ou pont Claude Code) le couple (ce qui a été dit, ce que la base propose) et
 * elle tranche : même aliment → on garde la base ; sinon elle estime elle-même
 * les valeurs nutritionnelles, que `computeItems` honorera (cf. compute.ts).
 *
 * Un seul appel groupé pour tous les items douteux, et repli silencieux sur le
 * comportement actuel en cas d'échec : la vérification est un bonus, jamais un
 * bloquant.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ExtractedItem, Food, NutrientKey } from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { matchFood } from '../nutrition/match';
import type { RecentCounts } from '../nutrition/match';
import { STRONG_DB_MATCH } from '../nutrition/compute';
import type { ExtractionMode } from '../store/store';
import { NUTRIMENTS_PROMPT_DOC } from './schema';

/** Toutes les clés de nutriments (ordre stable). */
const NUTRIENT_KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

const CATEGORIES = [
  'fruit', 'legume', 'feculent', 'viande', 'poisson', 'oeuf-laitier',
  'sucre-snack', 'matiere-grasse', 'boisson', 'plat', 'supplement', 'autre',
] as const;

const verdictSchema = z.object({
  i: z.number().int().nonnegative(),
  meme: z.boolean(),
  categorie: z.enum(CATEGORIES).optional(),
  grammesParPiece: z.number().positive().optional(),
  quantite: z.number().positive().optional(),
  quantiteMin: z.number().positive().optional(),
  quantiteMax: z.number().positive().optional(),
  nutriments: z
    .object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, z.number().nonnegative().optional()])))
    .optional() as z.ZodType<Partial<Record<NutrientKey, number>> | undefined>,
});

const responseSchema = z.object({ verdicts: z.array(verdictSchema) });

/** Un item soumis au jugement de l'IA. */
interface Doubtful {
  /** Index dans le tableau d'items d'origine. */
  index: number;
  item: ExtractedItem;
  /** Nom de l'aliment proposé par la base, ou `null` si elle n'a rien trouvé. */
  propose: string | null;
}

function systemPrompt(): string {
  return `Tu VÉRIFIES le résultat d'un moteur de recherche d'aliments. Ce moteur compare des textes : il ne comprend pas le sens et se trompe sur les plats composés, les préparations et les variantes.
Pour chaque élément, on te donne ce que l'utilisateur a DIT et l'aliment que la base a PROPOSÉ. Tu dois juger si c'est EXACTEMENT le même aliment.

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"verdicts":[{"i": number, "meme": boolean, ...}]}
- "i" : l'index de l'élément (celui donné dans la liste).
- "meme": true si l'aliment proposé désigne bien la même chose que ce qui a été dit (simple synonyme, singulier/pluriel, précision de cuisson équivalente, marque générique). N'ajoute alors AUCUN autre champ.
- "meme": false si c'est un aliment DIFFÉRENT (plat composé vs un de ses ingrédients, préparation différente, autre variante), ou si la base ne propose RIEN. Ajoute alors une estimation complète :
  - "categorie" ∈ ["fruit","legume","feculent","viande","poisson","oeuf-laitier","sucre-snack","matiere-grasse","boisson","plat","supplement","autre"]
  - "nutriments" : objet contenant TOUS les champs ci-dessous (n'en omets AUCUN ; 0 si négligeable)
  - "grammesParPiece" (optionnel) : poids en g d'une pièce/portion si l'unité est "piece"/"portion"
  - "quantite", "quantiteMin", "quantiteMax" (optionnels) : corrige la quantité si celle extraite est manifestement incohérente pour cet aliment, avec sa fourchette plausible. Si tu corriges la quantité, garde l'unité de l'élément (ne la change pas).

Sois EXIGEANT sur "meme" : au moindre doute sur le fait qu'il s'agit du même aliment, réponds false et estime. Une part de tarte aux myrtilles n'est PAS une myrtille ; un gâteau au chocolat n'est PAS du chocolat noir ; une soupe de potiron n'est PAS du potiron.
Mais ne sois pas tatillon sur les formulations : « pommes de terre vapeur » et « Pomme de terre (cuite à l'eau) », c'est le même aliment.
Quand la base ne propose RIEN, réponds toujours "meme": false et estime : sans ton estimation, cet aliment ne comptera pour rien dans le bilan de l'utilisateur.

${NUTRIMENTS_PROMPT_DOC}

Exemple :
Éléments :
[0] dit : "tarte à la myrtille" (1 portion) — la base propose : "Myrtille"
[1] dit : "pommes de terre vapeur" (200 g) — la base propose : "Pomme de terre (cuite à l'eau)"
[2] dit : "poke bowl saumon avocat" (1 bol) — la base propose : RIEN (aucune correspondance)
Sortie : {"verdicts":[{"i":0,"meme":false,"categorie":"sucre-snack","grammesParPiece":120,"quantiteMin":90,"quantiteMax":150,"nutriments":{"kcal":260,"proteines":3,"glucides":34,"lipides":12,"fibres":2,"agSatures":6,"agMonoInsatures":4,"agPolyInsatures":1,"omega3":0.1,"omega6":0.9,"omega9":3.5,"fer":0.8,"magnesium":10,"potassium":90,"calcium":20,"zinc":0.3,"sodium":150,"selenium":4,"iode":3,"vitA":60,"vitC":2,"vitD":0.3,"vitE":0.8,"vitK1":2,"vitK2":0.5,"vitB1":0.08,"vitB2":0.1,"vitB3":0.5,"vitB5":0.3,"vitB6":0.04,"vitB9":10,"vitB12":0.2,"creatine":0,"collagene":0}},{"i":1,"meme":true},{"i":2,"meme":false,"categorie":"plat","grammesParPiece":450,"quantiteMin":350,"quantiteMax":550,"nutriments":{"kcal":150,"proteines":9,"glucides":15,"lipides":6,"fibres":1.5,"agSatures":1.1,"agMonoInsatures":2.8,"agPolyInsatures":1.6,"omega3":0.6,"omega6":0.9,"omega9":2.6,"fer":0.5,"magnesium":22,"potassium":230,"calcium":18,"zinc":0.4,"sodium":320,"selenium":11,"iode":4,"vitA":20,"vitC":4,"vitD":2.5,"vitE":0.7,"vitK1":6,"vitK2":0.3,"vitB1":0.06,"vitB2":0.06,"vitB3":2.6,"vitB5":0.4,"vitB6":0.2,"vitB9":18,"vitB12":0.9,"creatine":0.1,"collagene":0.2}}]}`;
}

function userPrompt(doubtful: Doubtful[]): string {
  const lines = doubtful.map(
    (d) =>
      `[${d.index}] dit : "${d.item.aliment}" (${d.item.quantite} ${d.item.unite}) — la base propose : ${
        d.propose ? `"${d.propose}"` : 'RIEN (aucune correspondance)'
      }`,
  );
  return `Éléments :\n${lines.join('\n')}\nJSON :`;
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

async function askBridge(system: string, user: string): Promise<string> {
  const res = await fetch('/api/claude-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${system}\n\n${user}` }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.text ?? '';
}

async function askCloud(system: string, user: string, apiKey: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const resp = await client.messages.create({
    model,
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Items qui méritent l'avis de l'IA :
 *  - match incertain (score < quasi exact, ou douteux) : elle dit si c'est le
 *    même aliment ;
 *  - AUCUN match : sans elle, l'aliment resterait sans aucune valeur
 *    nutritionnelle (« douteux » et absent des totaux) — c'est là qu'une
 *    estimation apporte le plus.
 * Seuls les items déjà estimés à l'extraction sont ignorés : l'IA a déjà tranché.
 */
function doubtfulItems(items: ExtractedItem[], foods: Food[], recentCounts?: RecentCounts): Doubtful[] {
  const out: Doubtful[] = [];
  items.forEach((item, index) => {
    if (item.nutriments) return;
    const m = matchFood(item.aliment, foods, recentCounts);
    if (m.food && !m.douteux && m.score >= STRONG_DB_MATCH) return;
    out.push({ index, item, propose: m.food?.nom ?? null });
  });
  return out;
}

/**
 * Soumet les matchs incertains à l'IA forte et renvoie les items enrichis de son
 * estimation quand elle juge que l'aliment de la base n'est pas le bon.
 * Renvoie les items inchangés si le mode n'est pas une IA forte, s'il n'y a rien
 * à vérifier, ou si l'appel échoue.
 */
export async function verifyMatches(
  items: ExtractedItem[],
  foods: Food[],
  mode: ExtractionMode,
  apiKey: string,
  cloudModel: string,
  recentCounts?: RecentCounts,
): Promise<ExtractedItem[]> {
  if (mode !== 'cloud' && mode !== 'claudecode') return items;
  if (mode === 'cloud' && !apiKey) return items;

  const doubtful = doubtfulItems(items, foods, recentCounts);
  if (doubtful.length === 0) return items;

  let text: string;
  try {
    const system = systemPrompt();
    const user = userPrompt(doubtful);
    text = mode === 'cloud' ? await askCloud(system, user, apiKey, cloudModel) : await askBridge(system, user);
  } catch {
    return items; // IA indisponible : on garde le matching de la base.
  }

  const parsed = responseSchema.safeParse(extractJson(text));
  if (!parsed.success) return items;

  const out = [...items];
  const soumis = new Set(doubtful.map((d) => d.index));
  for (const v of parsed.data.verdicts) {
    // L'index doit désigner un item réellement soumis (l'IA peut halluciner).
    if (v.meme || !soumis.has(v.i) || !v.nutriments) continue;
    const base = out[v.i];
    const quantite = v.quantite ?? base.quantite;
    const min = v.quantiteMin;
    const max = v.quantiteMax;
    out[v.i] = {
      ...base,
      quantite,
      nutriments: { ...EMPTY_NUTRIENTS, ...v.nutriments },
      ...(v.categorie ? { categorie: v.categorie } : {}),
      ...(v.grammesParPiece ? { grammesParPiece: v.grammesParPiece } : {}),
      // Fourchette conservée seulement si cohérente (même règle que validateExtraction).
      ...(min != null && max != null && min < max && min <= quantite && quantite <= max
        ? { quantiteMin: min, quantiteMax: max }
        : {}),
    };
  }
  return out;
}
