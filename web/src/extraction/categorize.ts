/**
 * Classement groupé d'aliments dans les catégories de l'app.
 *
 * Les aliments que l'IA estime (plats composés, marques, spécialités) portent
 * désormais leur catégorie dès l'extraction. Mais tout l'historique saisi AVANT
 * n'en a pas : sans rattrapage, un filtre « poissons » sur l'historique raterait
 * les sardines à l'huile ou la truite fumée décrites par le LLM.
 *
 * D'où cet appel unique, à la demande : on envoie la liste des noms non classés
 * et on récupère leur catégorie. Pas de nutriments, pas de quantités — juste un
 * mot par aliment, donc une réponse courte même sur des dizaines d'aliments.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { FoodCategory } from '../nutrition/types';
import type { ExtractionMode } from '../store/store';

const CATEGORIES = [
  'fruit', 'legume', 'feculent', 'viande', 'poisson', 'oeuf-laitier',
  'sucre-snack', 'matiere-grasse', 'boisson', 'plat', 'supplement', 'autre',
] as const;

const responseSchema = z.object({
  categories: z.array(z.object({ i: z.number().int().nonnegative(), c: z.enum(CATEGORIES) })),
});

/** Au-delà, on découpe en plusieurs appels (réponse et prompt raisonnables). */
const BATCH = 60;

const SYSTEM_PROMPT = `Tu classes des aliments dans des catégories. On te donne une liste numérotée de noms d'aliments (français, parfois issus d'une dictée, parfois des plats composés).

Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"categories":[{"i": number, "c": "categorie"}]}
- "i" : l'index donné dans la liste. Réponds pour TOUS les éléments, sans en omettre.
- "c" ∈ ["fruit","legume","feculent","viande","poisson","oeuf-laitier","sucre-snack","matiere-grasse","boisson","plat","supplement","autre"]

Règles :
- "poisson" couvre poissons, fruits de mer et crustacés (y compris fumés, en conserve, panés).
- "viande" couvre viandes, volailles, charcuteries et abats.
- "plat" = préparation composée dont aucun ingrédient ne domine (pizza, burger, ratatouille, sandwich, tajine, quiche).
- Un aliment reste dans sa catégorie d'origine tant qu'un ingrédient domine clairement : "sardines à l'huile" → poisson, "escalope de poulet panée" → viande, "frites de patate douce" → feculent.
- "sucre-snack" : desserts, glaces, gâteaux, biscuits, confiseries, chips.
- "matiere-grasse" : huiles, beurres, crèmes et sauces grasses (aïoli, mayonnaise, guacamole).
- "supplement" : compléments alimentaires (protéine en poudre, créatine, inuline, vitamines).
- N'utilise "autre" qu'en dernier recours (épices, condiments, aliment incompréhensible).

Exemple :
Aliments :
[0] sardines à l'huile
[1] fondant au chocolat
[2] inuline
[3] pizza aux anchois
Sortie : {"categories":[{"i":0,"c":"poisson"},{"i":1,"c":"sucre-snack"},{"i":2,"c":"supplement"},{"i":3,"c":"plat"}]}`;

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

async function askBridge(user: string): Promise<string> {
  const res = await fetch('/api/claude-code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: `${SYSTEM_PROMPT}\n\n${user}`, label: 'catégories' }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.text ?? '';
}

async function askCloud(user: string, apiKey: string, model: string): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const resp = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: user }],
  });
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Classe une liste de noms d'aliments. Renvoie la catégorie par nom (tel que
 * fourni) : les noms que l'IA n'a pas renvoyés sont simplement absents.
 * Lève si l'IA n'est pas joignable — l'appelant affiche l'erreur, il n'y a pas
 * de repli utile ici (contrairement à l'extraction, où le matching prend le relais).
 */
export async function categorizeNames(
  names: string[],
  mode: ExtractionMode,
  apiKey: string,
  cloudModel: string,
): Promise<Record<string, FoodCategory>> {
  if (mode !== 'cloud' && mode !== 'claudecode') {
    throw new Error('Le classement demande une IA forte (Claude Code ou API Claude) — voir Réglages.');
  }
  if (mode === 'cloud' && !apiKey) throw new Error('Clé API manquante — voir Réglages.');

  const out: Record<string, FoodCategory> = {};
  for (let start = 0; start < names.length; start += BATCH) {
    const batch = names.slice(start, start + BATCH);
    const user = `Aliments :\n${batch.map((n, i) => `[${i}] ${n}`).join('\n')}\nJSON :`;
    const text = mode === 'cloud' ? await askCloud(user, apiKey, cloudModel) : await askBridge(user);
    const parsed = responseSchema.safeParse(extractJson(text));
    if (!parsed.success) throw new Error('Réponse de l’IA illisible.');
    for (const { i, c } of parsed.data.categories) {
      if (i >= 0 && i < batch.length) out[batch[i]] = c;
    }
  }
  return out;
}
