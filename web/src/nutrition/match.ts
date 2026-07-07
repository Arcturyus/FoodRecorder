import type { Food, MatchResult } from './types';
import { FOODS } from './foods';
import { normalizeForMatch, trigramSimilarity } from './normalize';

const DOUBT_THRESHOLD = 0.55;

interface Candidate {
  food: Food;
  score: number;
}

/** Mots vides fréquents dans les formulations orales. */
const STOPWORDS = new Set(['de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', "d'", 'au', 'aux', 'a', 'en']);

function tokens(s: string): string[] {
  return s.split(' ').filter((t) => t && !STOPWORDS.has(t));
}

function scoreAgainst(query: string, target: string): number {
  if (query === target) return 1;
  const qTokens = tokens(query);
  const tTokens = tokens(target);
  if (qTokens.length === 0 || tTokens.length === 0) return 0;

  // proportion de tokens de la requête présents dans la cible (et inversement, pondéré)
  const tSet = new Set(tTokens);
  let hits = 0;
  for (const q of qTokens) {
    if (tSet.has(q)) hits++;
    else if (tTokens.some((t) => t.startsWith(q) || q.startsWith(t))) hits += 0.7;
  }
  const coverage = hits / qTokens.length;
  const reverseCoverage = hits / tTokens.length;
  const tokenScore = 0.7 * coverage + 0.3 * reverseCoverage;

  const fuzzy = trigramSimilarity(query, target);
  return Math.max(fuzzy, 0.75 * tokenScore + 0.25 * fuzzy);
}

/** Score d'un aliment = meilleur score sur son nom et ses alias. */
function scoreFood(query: string, food: Food): number {
  let best = scoreAgainst(query, normalizeForMatch(food.nom));
  for (const alias of food.aliases) {
    const s = scoreAgainst(query, normalizeForMatch(alias));
    // léger malus sur les alias pour préférer le nom canonique à score égal
    if (s * 0.98 > best) best = s * 0.98;
  }
  return best;
}

/**
 * Matche un nom d'aliment dicté contre la base (+ aliments personnalisés).
 * Retourne le meilleur candidat, un flag `douteux` si le score est faible,
 * et le top 3 d'alternatives pour l'UI d'édition.
 */
export function matchFood(nom: string, customFoods: Food[] = []): MatchResult {
  const query = normalizeForMatch(nom);
  if (!query) return { food: null, score: 0, douteux: true, alternatives: [] };

  const all = [...customFoods, ...FOODS];
  const candidates: Candidate[] = all
    .map((food) => ({ food, score: scoreFood(query, food) }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.25) {
    return {
      food: null,
      score: best?.score ?? 0,
      douteux: true,
      alternatives: candidates.slice(0, 3).map((c) => c.food),
    };
  }
  return {
    food: best.food,
    score: best.score,
    douteux: best.score < DOUBT_THRESHOLD,
    alternatives: candidates.slice(1, 4).map((c) => c.food),
  };
}
