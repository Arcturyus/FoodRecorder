import type { Food, MatchResult } from './types';
import { normalizeForMatch, trigramSimilarity } from './normalize';

const DOUBT_THRESHOLD = 0.55;
/** Écart de score en-dessous duquel deux candidats sont jugés « équivalents ». */
const CLOSE_MARGIN = 0.12;

interface Candidate {
  food: Food;
  score: number;
}

/** Fréquences de consommation récentes (foodId → nb d'occurrences), pour départager. */
export type RecentCounts = Map<string, number>;

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
 * Matche un nom d'aliment dicté contre la liste d'aliments effectifs fournie
 * (banque avec overrides + aliments personnalisés). Retourne le meilleur
 * candidat, un flag `douteux` si le score est faible, et le top 3 d'alternatives.
 *
 * `recentCounts` (optionnel) : quand plusieurs candidats ont des scores très
 * proches (hésitation « fromage blanc 0 % vs 3 % vs skyr »), on choisit celui
 * le plus mangé les derniers jours plutôt que le premier de la liste.
 */
export function matchFood(nom: string, foods: Food[], recentCounts?: RecentCounts): MatchResult {
  const query = normalizeForMatch(nom);
  if (!query) return { food: null, score: 0, douteux: true, alternatives: [] };

  const candidates: Candidate[] = foods
    .map((food) => ({ food, score: scoreFood(query, food) }))
    .sort((a, b) => b.score - a.score);

  let best = candidates[0];
  if (!best || best.score < 0.25) {
    return {
      food: null,
      score: best?.score ?? 0,
      douteux: true,
      alternatives: candidates.slice(0, 3).map((c) => c.food),
    };
  }

  // Hésitation : parmi les candidats « équivalents » (score ≈ meilleur score),
  // on préfère l'aliment le plus consommé récemment (habitude de l'utilisateur).
  if (recentCounts && recentCounts.size > 0) {
    const close = candidates.filter((c) => best.score - c.score <= CLOSE_MARGIN);
    if (close.length > 1) {
      const preferred = close.reduce((a, b) =>
        (recentCounts.get(b.food.id) ?? 0) > (recentCounts.get(a.food.id) ?? 0) ? b : a,
      );
      if ((recentCounts.get(preferred.food.id) ?? 0) > (recentCounts.get(best.food.id) ?? 0)) best = preferred;
    }
  }

  return {
    food: best.food,
    score: best.score,
    douteux: best.score < DOUBT_THRESHOLD,
    alternatives: candidates
      .filter((c) => c.food.id !== best.food.id)
      .slice(0, 3)
      .map((c) => c.food),
  };
}
