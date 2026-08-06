import type { Food, Nutrients, NutrientKey } from './types';
import { EMPTY_NUTRIENTS } from './types';
import type { Target } from './targets';
import { RATIOS, computeRatio } from './ratios';
import { RDA } from './rda';

/**
 * Recommandations d'aliments et de suppléments à partir des manques observés.
 *
 * Principe : chaque nutriment « à couvrir » (goal atLeast) reçoit un poids qui
 * croît avec son manque relatif (manque^γ) ; chaque nutriment « à limiter »
 * (sodium, AG saturés) pénalise les aliments qui en apportent, d'autant plus
 * que la moyenne est proche ou au-dessus du plafond. Les rapports (ω6/ω3,
 * K/Na, Ca/Mg) hors zone se traduisent en poids : bonus sur le nutriment à
 * augmenter, malus sur celui à réduire — pas de logique séparée.
 *
 * Le score d'un aliment est calculé PAR PORTION HABITUELLE (pièce, dose,
 * tranche… sinon 100 g) : c'est ce qu'un vrai geste alimentaire apporte, et ça
 * évite que les épices ultra-denses trustent le classement. La contribution
 * d'un nutriment est cappée au manque restant : un aliment mono-nutriment ne
 * peut pas écraser le classement en sur-couvrant un seul manque.
 *
 * Les calories sont volontairement HORS SCORE (ni bonus ni malus) : en déficit
 * comme en surplus, elles se pilotent à part ; elles restent affichées dans le
 * détail pour juger le « coût » calorique d'une recommandation.
 */

export interface RecoParams {
  /** Exposant du manque : plus γ est haut, plus un gros manque domine les petits. */
  gamma: number;
  /** Multiplicateur du négatif : poids des excès (sodium, AG saturés, ω6…) dans le score. */
  lambda: number;
}

export const RECO_DEFAULTS: RecoParams = { gamma: 2, lambda: 1.5 };
export const GAMMA_BOUNDS = { min: 1, max: 4, step: 0.5 } as const;
export const LAMBDA_BOUNDS = { min: 0, max: 3, step: 0.25 } as const;
export const IMPORTANCE_BOUNDS = { min: 0, max: 3, step: 0.1 } as const;

/** Poids d'importance par défaut de chaque nutriment (métadonnée RDA, défaut 1). */
export const DEFAULT_IMPORTANCE: Partial<Record<NutrientKey, number>> = Object.fromEntries(
  RDA.filter((r) => r.importance != null && r.importance !== 1).map((r) => [r.key, r.importance!]),
);

/** Fonction d'importance : poids d'un nutriment dans les recommandations / conseils. */
export type ImportanceFn = (key: NutrientKey) => number;

/** Importance effective d'un nutriment = override utilisateur ?? défaut RDA ?? 1. */
export function effectiveImportance(
  key: NutrientKey,
  overrides: Partial<Record<NutrientKey, number>> = {},
): number {
  return overrides[key] ?? DEFAULT_IMPORTANCE[key] ?? 1;
}

/** Construit une `ImportanceFn` à partir des overrides utilisateur (defaults RDA inclus). */
export function makeImportanceFn(overrides: Partial<Record<NutrientKey, number>> = {}): ImportanceFn {
  return (key) => effectiveImportance(key, overrides);
}

/** Importance neutre (tout à 1) — défaut quand aucune pondération n'est fournie. */
const NEUTRAL_IMPORTANCE: ImportanceFn = () => 1;

/** Manque moyen d'un nutriment « à couvrir », avec son poids dans le score. */
export interface Gap {
  key: NutrientKey;
  target: Target;
  /** Apport moyen par jour sur la période analysée. */
  avg: number;
  /** Fraction manquante vs cible optimale (0 = couvert, 1 = aucun apport). */
  missing: number;
  /** Quantité/jour encore à couvrir (unité du nutriment), étendue si un rapport le réclame. */
  need: number;
  /** Poids dans le score : manque^γ, plus l'éventuel bonus de rapport hors zone. */
  weight: number;
  /** Libellé du rapport qui renforce ce nutriment (ex. « ω6/ω3 »), si bonus. */
  ratioBoost?: string;
}

/** Nutriment pénalisé (plafond ou rapport hors zone). */
export interface PenaltyDef {
  key: NutrientKey;
  target: Target;
  avg: number;
  /** Poids du malus (croît avec la proximité/le dépassement du plafond). */
  weight: number;
  /** Référence de normalisation de l'apport (plafond du nutriment). */
  cap: number;
  /** Origine du malus (« plafond » ou libellé du rapport). */
  reason: string;
}

export interface GapAnalysis {
  gaps: Gap[];
  penalties: PenaltyDef[];
}

/** Sévérité 0..1 d'un rapport hors zone (0 = dans la cible). */
function ratioSeverity(value: number | null, optimal: number, better: 'lower' | 'higher' | 'target', tolerance = 0.35): number {
  if (value == null) return 0;
  if (better === 'lower') return Math.min(1, Math.max(0, (value - optimal) / optimal));
  if (better === 'higher') return Math.min(1, Math.max(0, (optimal - value) / optimal));
  const dev = Math.abs(value - optimal) / optimal;
  return Math.min(1, Math.max(0, (dev - tolerance) / tolerance));
}

/**
 * Analyse des moyennes journalières : manques pondérés et malus, rapports inclus.
 * `averages` = apports moyens/jour (vitamine D soleil incluse de préférence).
 */
export function computeGaps(
  averages: Nutrients,
  targets: Target[],
  params: RecoParams,
  importance: ImportanceFn = NEUTRAL_IMPORTANCE,
): GapAnalysis {
  const { gamma } = params;
  const byKey = new Map(targets.map((t) => [t.key, t]));

  const gaps = new Map<NutrientKey, Gap>();
  const penalties = new Map<NutrientKey, PenaltyDef>();

  for (const t of targets) {
    if (t.key === 'kcal') continue; // hors score (voir en-tête)
    const avg = averages[t.key];
    if (t.goal === 'limit') {
      // Malus proportionnel à la proximité du plafond : déjà sensible sous le
      // plafond (un apport à 80 % du plafond n'est pas « gratuit »), et qui
      // croît vite au-dessus.
      const over = t.ajr > 0 ? avg / t.ajr : 0;
      const weight = Math.pow(Math.min(2, over), gamma);
      if (weight > 0.01) {
        penalties.set(t.key, { key: t.key, target: t, avg, weight, cap: t.ajr, reason: 'plafond' });
      }
      continue;
    }
    const missing = t.optimal > 0 ? Math.max(0, 1 - avg / t.optimal) : 0;
    if (missing <= 0.02) continue; // couvert
    gaps.set(t.key, {
      key: t.key,
      target: t,
      avg,
      missing,
      need: t.optimal - avg,
      weight: Math.pow(missing, gamma),
    });
  }

  // Rapports hors zone → bonus sur le nutriment à augmenter, malus sur l'autre.
  for (const def of RATIOS) {
    const r = computeRatio(def, averages);
    const sev = ratioSeverity(r.value, def.optimal, def.better, def.tolerance);
    if (sev <= 0) continue;
    const boost = Math.pow(sev, gamma);

    // Sens de la correction : quel nutriment augmenter, lequel réduire.
    let up: NutrientKey | null = null;
    let down: NutrientKey | null = null;
    if (def.better === 'lower') {
      up = def.den; down = def.num; // ω6/ω3 trop haut → plus d'ω3, moins d'ω6
    } else if (def.better === 'higher') {
      up = def.num; down = def.den; // K/Na trop bas → plus de K, moins de Na
    } else if (r.value != null) {
      // cible (Ca/Mg) : trop haut → plus de Mg, moins de Ca ; trop bas → plus de Ca.
      if (r.value > def.optimal) { up = def.den; down = def.num; }
      else up = def.num; // en dessous : on n'inflige pas de malus au dénominateur (Mg reste bon)
    }

    if (up) {
      const t = byKey.get(up);
      if (t && t.goal === 'atLeast') {
        const g = gaps.get(up);
        if (g) {
          g.weight += boost;
          g.need = Math.max(g.need, sev * t.optimal);
          g.ratioBoost = def.label;
        } else {
          // Nutriment déjà couvert en absolu mais que le rapport réclame quand même.
          gaps.set(up, {
            key: up, target: t, avg: averages[up], missing: 0,
            need: sev * t.optimal, weight: boost, ratioBoost: def.label,
          });
        }
      }
    }
    if (down) {
      const t = byKey.get(down);
      if (t) {
        const cap = t.goal === 'limit' ? t.ajr : t.optimal;
        const prev = penalties.get(down);
        if (prev) prev.weight += boost;
        else penalties.set(down, { key: down, target: t, avg: averages[down], weight: boost, cap, reason: def.label });
      }
    }
  }

  // Pondération finale par importance : un nutriment à 0 disparaît (manque ET excès),
  // sinon son poids est mis à l'échelle. Le manque restant (`need`) reste inchangé.
  const gapList = [...gaps.values()]
    .map((g) => ({ ...g, weight: g.weight * importance(g.key) }))
    .filter((g) => g.weight > 1e-6)
    .sort((a, b) => b.weight - a.weight);
  const penaltyList = [...penalties.values()]
    .map((p) => ({ ...p, weight: p.weight * importance(p.key) }))
    .filter((p) => p.weight > 1e-6)
    .sort((a, b) => b.weight - a.weight);

  return { gaps: gapList, penalties: penaltyList };
}

// ---------------------------------------------------------------------------
// Score des aliments
// ---------------------------------------------------------------------------

/**
 * Portion « habituelle » d'un aliment en grammes : ce qu'un geste réaliste
 * représente (une pièce, une dose, une tranche…), 100 g à défaut. Pour les
 * toutes petites pièces (cerise 8 g), une poignée / un bol est plus réaliste.
 */
export function portionGrams(food: Food): number {
  const u = food.unitGrams ?? {};
  let g = [u.portion, food.pieceGrams, u.dose, u.tranche, u.pot, u.verre, u.bol, u.poignee, u.cas, u.assiette]
    .find((x) => x != null && x > 0);
  if (g != null && g < 15) g = Math.max(g, u.poignee ?? 0, u.bol ?? 0, u.tranche ?? 0);
  return g && g > 0 ? g : 100;
}

/** Contribution (ou malus) d'un nutriment au score d'un aliment. */
export interface ScorePart {
  key: NutrientKey;
  target: Target;
  /** Apport de la portion (unité du nutriment). */
  amount: number;
  /** Points signés apportés au score (déjà multipliés par λ pour les malus). */
  points: number;
  /** Origine d'un malus de rapport (sinon absent). */
  reason?: string;
}

export interface ScoredFood {
  food: Food;
  portionG: number;
  kcal: number;
  score: number;
  positive: number;
  negative: number;
  /** Contributions positives puis malus, triés par |points| décroissants. */
  parts: ScorePart[];
}

/** Score d'un aliment pour une portion habituelle, face aux manques analysés. */
export function scoreFood(food: Food, analysis: GapAnalysis, params: RecoParams): ScoredFood {
  const portionG = portionGrams(food);
  const factor = portionG / 100;
  const pos: ScorePart[] = [];
  const neg: ScorePart[] = [];

  let positive = 0;
  for (const g of analysis.gaps) {
    const amount = food.n[g.key] * factor;
    if (amount <= 0 || g.target.optimal <= 0) continue;
    // Cappée au manque restant : sur-couvrir un manque n'apporte plus de points.
    const points = g.weight * (Math.min(amount, g.need) / g.target.optimal);
    if (points <= 0) continue;
    positive += points;
    pos.push({ key: g.key, target: g.target, amount, points, reason: g.ratioBoost });
  }

  let negative = 0;
  for (const p of analysis.penalties) {
    const amount = food.n[p.key] * factor;
    if (amount <= 0 || p.cap <= 0) continue;
    const points = p.weight * Math.min(3, amount / p.cap);
    if (points <= 0) continue;
    negative += points;
    neg.push({ key: p.key, target: p.target, amount, points: -params.lambda * points, reason: p.reason === 'plafond' ? undefined : p.reason });
  }

  const score = positive - params.lambda * negative;
  return {
    food,
    portionG,
    kcal: food.n.kcal * factor,
    score,
    positive,
    negative: params.lambda * negative,
    parts: [...pos, ...neg].sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
  };
}

/** Classement décroissant d'un ensemble d'aliments face aux manques. */
export function rankFoods(foods: Food[], analysis: GapAnalysis, params: RecoParams): ScoredFood[] {
  return foods
    .map((f) => scoreFood(f, analysis, params))
    .filter((s) => s.parts.length > 0)
    .sort((a, b) => b.score - a.score || a.food.nom.localeCompare(b.food.nom, 'fr'));
}

// ---------------------------------------------------------------------------
// Pondération « ces derniers jours » (décroissance exponentielle)
// ---------------------------------------------------------------------------

/**
 * Portée d'un conseil : la journée en cours, ou une moyenne pondérée des jours
 * précédents (le récent pèse plus). Les deux passent par le MÊME moteur — seuls
 * le total d'entrée, le seuil d'avancement et la formulation changent.
 */
export type AdviceScope = 'jour' | 'recents';

/** Demi-vie par défaut de la pondération, en jours (un jour de 3 j pèse moitié moins). */
export const DECAY_HALF_LIFE_DEFAULT = 3;
/** Demi-vies proposées à l'écran (jours). */
export const HALF_LIFE_CHOICES = [1, 2, 3, 5, 7, 14];
/** Poids relatif sous lequel un jour ne compte plus : c'est lui qui borne la fenêtre. */
const DECAY_MIN_WEIGHT = 0.1;

/** Poids d'un jour vieux de `age` jours : 1 le jour d'ancrage, ½ à chaque demi-vie. */
export function decayWeight(age: number, halfLife: number): number {
  return Math.pow(0.5, age / Math.max(0.5, halfLife));
}

/**
 * Profondeur de la fenêtre DÉDUITE de la demi-vie : on remonte tant qu'un jour
 * pèse au moins `DECAY_MIN_WEIGHT` du plus récent (demi-vie 3 j → 10 jours).
 * Un seul réglage à comprendre — la demi-vie — plutôt que deux qui interagissent.
 */
export function decayWindowDays(halfLife: number): number {
  const ratio = Math.log(DECAY_MIN_WEIGHT) / Math.log(0.5); // ≈ 3,32 demi-vies
  return Math.max(1, Math.ceil(ratio * Math.max(0.5, halfLife)));
}

/** Un jour de la fenêtre pondérée : ses totaux et le poids qu'il porte. */
export interface WeightedDay {
  date: string;
  weight: number;
  totals: Nutrients;
}

/**
 * Moyenne pondérée d'un ensemble de journées. Le résultat est homogène à UNE
 * journée (somme des poids au dénominateur) : il se compare donc exactement aux
 * mêmes cibles journalières que les totaux du jour, et traverse `dayAdvice` /
 * `macroAdvice` sans aucune adaptation des seuils.
 */
export function decayWeightedTotals(days: WeightedDay[]): Nutrients {
  const out = { ...EMPTY_NUTRIENTS };
  const sum = days.reduce((a, d) => a + d.weight, 0);
  if (sum <= 0) return out;
  const keys = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];
  for (const d of days) for (const k of keys) out[k] += (d.totals[k] ?? 0) * d.weight;
  for (const k of keys) out[k] /= sum;
  return out;
}

// ---------------------------------------------------------------------------
// Conseils du jour (section courte de l'écran Aujourd'hui)
// ---------------------------------------------------------------------------

/** Suggestion concrète : un aliment/supplément et ce qu'une portion apporte. */
export interface Suggestion {
  food: Food;
  portionG: number;
  /** Apport d'une portion pour le nutriment visé. */
  amount: number;
}

export interface DayAdviceItem {
  kind: 'deficit' | 'excess' | 'ratio';
  /** Nutriment concerné (deficit/excess). */
  target?: Target;
  /** Rapport concerné (ratio). */
  ratioLabel?: string;
  /** Unité des suggestions (celle du nutriment corrigé — utile pour les rapports). */
  suggestionUnit?: string;
  /** Situation en une phrase courte. */
  text: string;
  /** Suppléments qui comblent (déficit uniquement). */
  supplements: Suggestion[];
  /** Aliments qui comblent / corrigent. */
  foodSuggestions: Suggestion[];
}

/** Fraction de l'objectif kcal en dessous de laquelle on ne juge pas la journée. */
export const DAY_MIN_PROGRESS = 0.3;
/** Couverture relative au rythme de la journée sous laquelle un nutriment alerte. */
const DAY_LAG_THRESHOLD = 0.45;
/** Nombre maximal d'alertes affichées. */
const DAY_MAX_ITEMS = 6;
/** Nombre d'aliments suggérés par alerte (déficit/ratio), affichés d'un coup. */
export const DAY_FOOD_SUGGESTIONS = 4;
/**
 * Nombre de « fournées » de suggestions préparées d'avance : l'écran n'en montre
 * qu'une (DAY_FOOD_SUGGESTIONS), le bouton « ⟳ Autres idées » fait tourner les
 * suivantes — utile quand aucune des propositions ne convient (pas envie, pas au
 * frigo…). Calculer les pages ici, une fois, évite de recalculer un classement à
 * chaque clic.
 */
export const SUGGESTION_PAGES = 4;

/**
 * Meilleures sources d'un nutriment, par portion habituelle, cappées au besoin
 * restant. Diversifie les catégories d'aliments (pas 4 poissons d'affilée) et,
 * si possible, inclut au moins un aliment déjà consommé par l'utilisateur —
 * plus actionnable qu'une source jamais essayée.
 *
 * `limit` peut couvrir plusieurs pages d'affichage : `pageSize` dit alors combien
 * d'éléments l'écran montre en même temps, pour que la garantie « au moins un
 * aliment déjà mangé » porte sur la PREMIÈRE page (celle qu'on voit) et non sur
 * la fin d'une liste qu'il faudrait faire défiler pour atteindre.
 */
export function topSourcesFor(
  key: NutrientKey,
  need: number,
  foods: Food[],
  opts: {
    supplements: boolean;
    limit: number;
    /** Taille de la fenêtre affichée (défaut : `limit`, donc tout d'un coup). */
    pageSize?: number;
    exclude?: NutrientKey;
    excludeFactor?: number;
    consumedIds?: Set<string>;
  },
): Suggestion[] {
  const exclFactor = opts.excludeFactor ?? 1;
  const candidates = foods
    .filter((f) => (f.categorie === 'supplement') === opts.supplements && f.n[key] > 0)
    .map((f) => {
      const portionG = portionGrams(f);
      return { food: f, portionG, amount: f.n[key] * (portionG / 100) };
    })
    // On écarte les sources dont le nutriment « opposé » dépasse `excludeFactor ×`
    // le nutriment visé : elles aggraveraient le rapport qu'on cherche à corriger
    // (ex. sources de potassium très salées quand on veut corriger K/Na).
    .filter((s) => !opts.exclude || s.food.n[opts.exclude] * (s.portionG / 100) <= exclFactor * s.amount)
    .sort((a, b) => Math.min(b.amount, need) - Math.min(a.amount, need) || b.amount - a.amount);

  let picked: Suggestion[];
  if (opts.supplements) {
    picked = candidates.slice(0, opts.limit);
  } else {
    // 1re passe : le meilleur de chaque catégorie encore inutilisée (variété).
    picked = [];
    const usedCategories = new Set<string>();
    for (const c of candidates) {
      if (picked.length >= opts.limit) break;
      if (usedCategories.has(c.food.categorie)) continue;
      usedCategories.add(c.food.categorie);
      picked.push(c);
    }
    // 2e passe : complète avec les meilleurs restants, catégories déjà vues incluses.
    for (const c of candidates) {
      if (picked.length >= opts.limit) break;
      if (picked.includes(c)) continue;
      picked.push(c);
    }
  }

  // Garantit au moins un aliment déjà mangé DANS LA PREMIÈRE PAGE, si l'un des
  // candidats l'est.
  if (opts.consumedIds) ensureKnownInFirstPage(picked, candidates, opts.consumedIds, opts.pageSize ?? opts.limit);

  return picked;
}

/**
 * Place un aliment déjà consommé dans la fenêtre visible `[0, pageSize)` si elle
 * n'en contient aucun : le dernier élément de la fenêtre lui cède sa place, et
 * l'aliment est retiré de sa position ultérieure éventuelle (pas de doublon dans
 * les pages suivantes). Mutation en place, partagée par les deux classements.
 */
function ensureKnownInFirstPage<T extends { food: Food }>(
  picked: T[],
  candidates: T[],
  consumedIds: Set<string>,
  pageSize: number,
): void {
  const win = Math.min(pageSize, picked.length);
  if (win <= 0 || picked.slice(0, win).some((s) => consumedIds.has(s.food.id))) return;
  const known = candidates.find((c) => consumedIds.has(c.food.id));
  if (!known) return;
  const later = picked.indexOf(known); // -1, ou ≥ win (sinon la fenêtre en contenait un)
  picked[win - 1] = known;
  if (later >= win) picked.splice(later, 1);
}

/** Options communes des suggestions d'aliments (déjà consommés inclus, variété). */
function foodOpts(consumedIds: Set<string>, extra: Partial<Parameters<typeof topSourcesFor>[3]> = {}) {
  return {
    supplements: false,
    limit: DAY_FOOD_SUGGESTIONS * SUGGESTION_PAGES,
    pageSize: DAY_FOOD_SUGGESTIONS,
    consumedIds,
    ...extra,
  };
}

/**
 * Alertes « choquantes » de la journée en cours : plafonds déjà dépassés,
 * rapports hors zone, nutriments très en retard sur le rythme du jour
 * (couverture rapportée à l'avancement calorique, pour ne pas tout signaler au
 * petit-déjeuner). Chaque alerte est notée par sévérité (0..~2+) pour prioriser
 * les 6 plus parlantes si tout ne tient pas. Renvoie [] tant que la journée est
 * trop peu avancée.
 *
 * En portée « recents », `totals` est la moyenne pondérée de journées TERMINÉES
 * (cf. `decayWeightedTotals`) : le seuil d'avancement ne s'applique pas et la
 * couverture se compare à la cible pleine (p = 1) et non au rythme d'un jour en
 * cours. Seules les formulations changent — les seuils, eux, sont les mêmes.
 */
export function dayAdvice(
  totals: Nutrients,
  targets: Target[],
  foods: Food[],
  consumedIds: Set<string> = new Set(),
  importance: ImportanceFn = NEUTRAL_IMPORTANCE,
  scope: AdviceScope = 'jour',
): DayAdviceItem[] {
  const kcalT = targets.find((t) => t.key === 'kcal');
  if (!kcalT || kcalT.optimal <= 0) return [];
  const progress = totals.kcal / kcalT.optimal;
  if (scope === 'jour' ? progress < DAY_MIN_PROGRESS : progress <= 0) return [];
  const p = scope === 'jour' ? Math.min(1, progress) : 1;
  /** « d'ici ce soir » n'a aucun sens sur une moyenne de jours déjà passés. */
  const horizon = scope === 'jour' ? "d'ici ce soir" : 'par jour';

  const scored: { item: DayAdviceItem; rank: number }[] = [];

  // 1. Plafonds déjà dépassés (sodium, AG saturés, AG trans) — le plus « choquant ».
  for (const t of targets) {
    if (t.goal !== 'limit' || t.ajr <= 0) continue;
    const imp = importance(t.key);
    if (imp <= 0) continue; // nutriment mis en sourdine : aucun conseil
    const v = totals[t.key];
    if (v <= t.ajr) continue;
    scored.push({
      rank: (300 + Math.min(2, v / t.ajr)) * imp,
      item: {
        kind: 'excess',
        target: t,
        text:
          scope === 'jour'
            ? `${t.label} : ${Math.round((v / t.ajr) * 100)} % du plafond journalier déjà atteint — évitez d'en rajouter d'ici ce soir.`
            // Volontairement factuel : c'est le compte de jours dépassés affiché
            // juste en dessous qui dit si l'excès est installé ou isolé — une
            // moyenne seule ne permet pas de trancher.
            : `${t.label} : ${Math.round((v / t.ajr) * 100)} % du plafond journalier en moyenne sur la fenêtre.`,
        supplements: [],
        foodSuggestions: [],
      },
    });
  }

  // 2. Rapports franchement hors zone, avec une quantité réelle à corriger
  // (calculée pour ramener le rapport à l'idéal, pas un seuil arbitraire).
  for (const def of RATIOS) {
    const r = computeRatio(def, totals);
    if (r.status !== 'bad' || r.value == null) continue;
    let text = '';
    let suggestions: Suggestion[] = [];
    let suggestionUnit = 'mg';
    let severity = 0;
    if (def.key === 'o6o3') {
      suggestionUnit = 'g';
      const need = Math.max(0, totals.omega6 / def.optimal - totals.omega3);
      severity = need / Math.max(1, totals.omega3 || 1);
      text = `Rapport ${def.label} à ${r.text} (idéal ≤ ${def.optimal}:1) : trop d'oméga-6 pour vos oméga-3 — il faudrait environ ${roundNeed(need)} g d'oméga-3 en plus ${scope === 'jour' ? "aujourd'hui" : 'par jour'} (ou moins d'huiles riches en ω6).`;
      suggestions = topSourcesFor('omega3', need || 1, foods, foodOpts(consumedIds, { exclude: 'omega6', excludeFactor: def.optimal }));
    } else if (def.key === 'kna') {
      const need = Math.max(0, def.optimal * totals.sodium - totals.potassium);
      severity = need / 1000;
      text = `Rapport ${def.label} à ${r.text} (idéal ≥ ${def.optimal}:1) : trop de sel pour votre potassium — il faudrait environ ${roundNeed(need)} mg de potassium en plus (ou moins de sel).`;
      suggestions = topSourcesFor('potassium', need || 500, foods, foodOpts(consumedIds, { exclude: 'sodium', excludeFactor: 1 / def.optimal }));
    } else if (def.key === 'camg') {
      const tooHigh = r.value > def.optimal;
      const need = tooHigh
        ? Math.max(0, totals.calcium / def.optimal - totals.magnesium)
        : Math.max(0, def.optimal * totals.magnesium - totals.calcium);
      severity = need / 200;
      text = `Rapport ${def.label} à ${r.text} (idéal ≈ ${def.optimal}:1) : ${tooHigh ? `beaucoup de calcium pour peu de magnésium — environ ${roundNeed(need)} mg de magnésium en plus comblerait l'écart` : `peu de calcium pour votre magnésium — environ ${roundNeed(need)} mg de calcium en plus comblerait l'écart`}.`;
      suggestions = topSourcesFor(tooHigh ? 'magnesium' : 'calcium', need || 100, foods, foodOpts(consumedIds));
    }
    scored.push({
      rank: 200 + Math.min(2, severity),
      item: { kind: 'ratio', ratioLabel: def.label, suggestionUnit, text, supplements: [], foodSuggestions: suggestions },
    });
  }

  // 3. Nutriments en retard sur le rythme de la journée (tous, triés par sévérité).
  // Glucides/lipides/fibres sont exclus : déjà couverts dans la section macros
  // (macroAdvice, laggingMacros) pour éviter de les afficher deux fois.
  const lagging = targets
    .filter((t) => t.goal === 'atLeast' && t.key !== 'kcal' && t.optimal > 0 && importance(t.key) > 0)
    .filter((t) => !MACRO_SECONDARY_KEYS.includes(t.key))
    .map((t) => ({ t, relCov: totals[t.key] / t.optimal / p }))
    .filter(({ relCov }) => relCov < DAY_LAG_THRESHOLD);

  for (const { t, relCov } of lagging) {
    const need = t.optimal - totals[t.key];
    scored.push({
      rank: 100 * (1 - relCov) * importance(t.key),
      item: {
        kind: 'deficit',
        target: t,
        text:
          scope === 'jour'
            ? `${t.label} : ${Math.round(relCov * 100)} % du rythme attendu — il manque encore ${roundNeed(need)} ${t.unit} ${horizon}.`
            : `${t.label} : ${Math.round(relCov * 100)} % de la cible en moyenne — il manquait environ ${roundNeed(need)} ${t.unit} ${horizon}.`,
        supplements: topSourcesFor(t.key, need, foods, { supplements: true, limit: 1 })
          .filter((s) => s.amount >= need * 0.2),
        foodSuggestions: topSourcesFor(t.key, need, foods, foodOpts(consumedIds)),
      },
    });
  }

  return scored
    .sort((a, b) => b.rank - a.rank)
    .slice(0, DAY_MAX_ITEMS)
    .map((s) => s.item);
}

// ---------------------------------------------------------------------------
// Classement « les plus bas en ce moment » (toujours affiché)
// ---------------------------------------------------------------------------

/** Nombre de nutriments listés dans le classement des manques. */
export const LOWEST_COUNT = 5;

/**
 * Nutriments écartés du classement : la créatine s'obtient surtout par
 * complément et son manque n'est pas un problème de santé — c'est même ce qui a
 * motivé les poids d'importance. Au pourcentage de cible elle serait presque
 * toujours en tête et masquerait les vrais manques. Le collagène, lui, reste :
 * son importance faible (0,6) suffit à le faire redescendre quand il le faut.
 */
const LOWEST_EXCLUDED: NutrientKey[] = ['creatine'];

/** Un nutriment du classement des manques, avec de quoi le combler. */
export interface LowCoverage {
  target: Target;
  /** Apport constaté (unité du nutriment). */
  value: number;
  /** Couverture 0..1+ : part de la cible atteinte, rapportée au rythme du jour en portée « jour ». */
  coverage: number;
  /** Ce qu'il reste à couvrir pour atteindre la cible. */
  missing: number;
  /** Meilleure source alimentaire de la base, si elle existe. */
  best: Suggestion | null;
}

/**
 * Les nutriments les plus bas EN CE MOMENT — la question « qu'est-ce qui me
 * manque le plus ? », à laquelle les alertes ne répondent pas : elles ont un
 * seuil (45 % du rythme attendu) et disparaissent entièrement dès que rien n'est
 * assez grave, ce qui laisse croire à tort que tout est couvert.
 *
 * Le tri est celui des alertes — manque × importance — pour que les deux listes
 * racontent la même histoire, et il ne retient que les nutriments « à couvrir »
 * hors calories et macros secondaires, qui ont leur propre section.
 */
export function lowestCoverage(
  totals: Nutrients,
  targets: Target[],
  foods: Food[],
  importance: ImportanceFn = NEUTRAL_IMPORTANCE,
  scope: AdviceScope = 'jour',
  limit = LOWEST_COUNT,
): LowCoverage[] {
  const kcalT = targets.find((t) => t.key === 'kcal');
  // Rythme attendu : en portée « jour », un nutriment n'est pas « bas » s'il
  // suit simplement l'avancement calorique de la journée.
  const p =
    scope === 'jour' && kcalT && kcalT.optimal > 0
      ? Math.min(1, Math.max(totals.kcal / kcalT.optimal, 0.01))
      : 1;

  return targets
    .filter((t) => t.goal === 'atLeast' && t.key !== 'kcal' && t.optimal > 0)
    .filter((t) => !MACRO_SECONDARY_KEYS.includes(t.key))
    .filter((t) => !LOWEST_EXCLUDED.includes(t.key) && importance(t.key) > 0)
    .map((t) => {
      const coverage = totals[t.key] / t.optimal / p;
      return { t, coverage, rank: (1 - Math.min(1, coverage)) * importance(t.key) };
    })
    .filter(({ coverage }) => coverage < 1) // rien à dire d'un nutriment déjà couvert
    .sort((a, b) => b.rank - a.rank || a.coverage - b.coverage)
    .slice(0, limit)
    .map(({ t, coverage }) => {
      const missing = Math.max(0, t.optimal - totals[t.key]);
      // Pas de `consumedIds` ici : sur UNE seule suggestion, la garantie « au
      // moins un aliment déjà mangé » remplacerait la meilleure source par une
      // source familière parfois bien plus pauvre.
      const best = topSourcesFor(t.key, missing || t.optimal, foods, { supplements: false, limit: 1 })[0];
      return { target: t, value: totals[t.key], coverage, missing, best: best ?? null };
    });
}

function roundNeed(v: number): number {
  if (v >= 100) return Math.round(v / 10) * 10;
  if (v >= 10) return Math.round(v);
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------
// Conseils du jour — section macros (calories restantes, priorité protéines)
// ---------------------------------------------------------------------------

/** Suggestion pour compléter les macros : ce qu'apporte une portion habituelle. */
export interface MacroSuggestion {
  food: Food;
  portionG: number;
  /** Protéines apportées par la portion (g). */
  prot: number;
  /** Énergie apportée par la portion (kcal). */
  kcal: number;
}

export interface MacroAdvice {
  /** Calories restantes vs objectif (peut être négatif = objectif dépassé). */
  kcalLeft: number;
  /** Protéines restantes vs objectif (g, ≥ 0). */
  protLeft: number;
  /** Ton du conseil selon l'état du jour. */
  tone: 'lean' | 'balanced' | 'protDone';
  /** Phrase de contexte + conseil adaptatif. */
  text: string;
  /** Autres macros en retard sur le rythme calorique (glucides/lipides/fibres). */
  laggingMacros: { target: Target; remaining: number }[];
  /**
   * Aliments classés pour combler, protéines/kcal en priorité. La liste couvre
   * plusieurs pages de `MACRO_MAX_SUGGESTIONS` : l'écran en montre une à la fois
   * et fait tourner les suivantes à la demande.
   */
  suggestions: MacroSuggestion[];
}

/** Macros secondaires, prises en compte seulement si en retard (« reste si retard »). */
export const MACRO_SECONDARY_KEYS: NutrientKey[] = ['glucides', 'lipides', 'fibres'];
/** Nombre d'aliments affichés d'un coup dans la section macros. */
export const MACRO_MAX_SUGGESTIONS = 5;

/**
 * Section « compléter tes macros » de l'écran Aujourd'hui : combien de calories
 * et de protéines il reste à couvrir, et quels aliments s'y prêtent le mieux.
 *
 * Contrairement aux alertes micronutriments (`dayAdvice`), cette section n'est
 * PAS soumise au seuil d'avancement du jour (30 % des kcal) : savoir combien il
 * reste à manger est utile dès la première entrée de la journée. Elle apparaît
 * donc dès que `totals.kcal > 0`, et se retire d'elle-même quand protéines et
 * calories sont couvertes (ou qu'il n'y a encore rien eu aujourd'hui).
 *
 * Le classement est piloté par les protéines et l'énergie restante, et il
 * s'adapte à l'état de la journée : quand la marge calorique est faible mais
 * qu'il manque beaucoup de protéines (ex. 80 % des kcal pour 40 % des prot),
 * un malus de dépassement calorique fait remonter le très protéiné et maigre.
 */
export function macroAdvice(
  totals: Nutrients,
  targets: Target[],
  foods: Food[],
  consumedIds: Set<string> = new Set(),
  importance: ImportanceFn = NEUTRAL_IMPORTANCE,
  scope: AdviceScope = 'jour',
): MacroAdvice | null {
  if (totals.kcal <= 0) return null; // rien mangé aujourd'hui : rien à conseiller
  const kcalT = targets.find((t) => t.key === 'kcal');
  const protT = targets.find((t) => t.key === 'proteines');
  if (!kcalT || !protT || kcalT.optimal <= 0 || protT.optimal <= 0) return null;
  // Note : pas de garde sur importance('proteines') ici — ce curseur pondère le
  // système de manques en micronutriments, pas le suivi macro/kcal qui est le
  // cœur de cette section et doit rester visible même si l'utilisateur a mis
  // les protéines en sourdine côté micronutriments.

  const kcalLeft = kcalT.optimal - totals.kcal;
  const protLeft = Math.max(0, protT.optimal - totals.proteines);
  const kcalPct = totals.kcal / kcalT.optimal;
  const protPct = totals.proteines / protT.optimal;

  const protDone = protLeft <= Math.max(2, 0.03 * protT.optimal);
  const kcalDone = kcalLeft <= Math.max(50, 0.03 * kcalT.optimal);
  if (protDone && kcalDone) return null; // rien à compléter

  // Macros secondaires en retard sur le rythme calorique du jour. Sur une
  // moyenne de journées terminées, le « rythme » est celui d'un jour entier.
  const p = scope === 'jour' ? Math.min(1, Math.max(kcalPct, 0.01)) : 1;
  const lagging = MACRO_SECONDARY_KEYS
    .map((key) => targets.find((t) => t.key === key))
    .filter((t): t is Target => !!t && t.optimal > 0 && importance(t.key) > 0)
    .map((t) => ({ target: t, remaining: Math.max(0, t.optimal - totals[t.key]), relCov: totals[t.key] / t.optimal / p }))
    .filter((m) => m.relCov < DAY_LAG_THRESHOLD && m.remaining > 0);

  // Ton adaptatif : protéines en retard sur les calories ⇒ viser maigre & très protéiné.
  const proteinBehind = !protDone && (kcalLeft <= 0 || kcalPct - protPct >= 0.15);
  let tone: MacroAdvice['tone'];
  let text: string;
  if (protDone) {
    tone = 'protDone';
    text = scope === 'jour'
      ? `Protéines bouclées — il te reste environ ${roundNeed(Math.max(0, kcalLeft))} kcal, à compléter plus librement.`
      : `Protéines bouclées en moyenne — il restait environ ${roundNeed(Math.max(0, kcalLeft))} kcal par jour, à compléter plus librement.`;
  } else if (proteinBehind) {
    tone = 'lean';
    const head = kcalLeft <= 0
      ? scope === 'jour'
        ? `Objectif calorique atteint mais il manque encore ${roundNeed(protLeft)} g de protéines`
        : `Objectif calorique atteint en moyenne mais il manquait ${roundNeed(protLeft)} g de protéines par jour`
      : scope === 'jour'
        ? `Calories bien avancées (${Math.round(kcalPct * 100)} %) mais pas les protéines (${Math.round(protPct * 100)} %)`
        : `Calories couvertes à ${Math.round(kcalPct * 100)} % en moyenne mais protéines à ${Math.round(protPct * 100)} %`;
    text = `${head} : privilégie des aliments très protéinés et peu caloriques (volaille maigre, poisson blanc, fromage blanc 0 %, œufs…).`;
  } else {
    tone = 'balanced';
    text = scope === 'jour'
      ? `Il reste environ ${roundNeed(Math.max(0, kcalLeft))} kcal et ${roundNeed(protLeft)} g de protéines : ces aliments t'en rapprochent.`
      : `Il manquait en moyenne ${roundNeed(Math.max(0, kcalLeft))} kcal et ${roundNeed(protLeft)} g de protéines par jour : ces aliments comblent l'écart.`;
  }

  const suggestions = rankMacroFoods(foods, { kcalLeft, protLeft, lagging, consumedIds });

  return {
    kcalLeft,
    protLeft,
    tone,
    text,
    laggingMacros: lagging.map(({ target, remaining }) => ({ target, remaining })),
    suggestions,
  };
}

/**
 * Classe les aliments pour combler les macros : les protéines dominent le score,
 * l'énergie restante compte peu, et un malus de dépassement calorique — d'autant
 * plus fort que la marge kcal est faible — favorise les aliments protéinés maigres
 * quand c'est ce dont la journée a besoin. Diversifie les catégories, garde si
 * possible un aliment déjà consommé.
 */
function rankMacroFoods(
  foods: Food[],
  ctx: {
    kcalLeft: number;
    protLeft: number;
    lagging: { target: Target; remaining: number }[];
    consumedIds: Set<string>;
  },
): MacroSuggestion[] {
  const { kcalLeft, protLeft } = ctx;
  const protDen = Math.max(protLeft, 1);
  const kcalPos = Math.max(kcalLeft, 0);
  // Échelle du malus : plus la marge calorique est faible, plus un aliment gras
  // et peu protéiné est puni ⇒ remonte le très protéiné quand la journée l'exige.
  const overScale = Math.max(kcalPos, 300);
  // Poids fixe (pas de dépendance à importance('proteines') : ce curseur pondère
  // le système de manques en micronutriments, pas ce classement macro).
  const wProt = 5;

  const scored = foods
    .filter((f) => f.categorie !== 'supplement' && f.n.proteines > 0)
    .map((f) => {
      const portionG = portionGrams(f);
      const factor = portionG / 100;
      const prot = f.n.proteines * factor;
      const kcal = f.n.kcal * factor;

      const protFill = protLeft > 0 ? Math.min(prot, protLeft) / protDen : 0;
      let laggingBonus = 0;
      for (const m of ctx.lagging) {
        const amt = f.n[m.target.key] * factor;
        if (amt > 0) laggingBonus += (0.3 * Math.min(amt, m.remaining)) / Math.max(m.remaining, 1);
      }
      // Tant qu'il manque des protéines, chaque calorie « coûte » (malus adaptatif :
      // marge serrée ⇒ le maigre très protéiné remonte). Une fois les protéines
      // couvertes, on cherche au contraire à remplir les calories restantes.
      let score: number;
      if (protLeft > 0) {
        score = wProt * protFill + laggingBonus - (2 * kcal) / overScale;
      } else {
        const kcalFill = kcalPos > 0 ? Math.min(kcal, kcalPos) / kcalPos : 0;
        const overshoot = Math.max(0, kcal - kcalPos) / overScale;
        score = kcalFill + laggingBonus - 2 * overshoot;
      }
      return { food: f, portionG, prot, kcal, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.prot - a.prot);

  // Plusieurs pages d'avance : l'écran en montre MACRO_MAX_SUGGESTIONS et fait
  // tourner les suivantes quand aucune ne convient.
  const total = MACRO_MAX_SUGGESTIONS * SUGGESTION_PAGES;
  // 1re passe : le meilleur de chaque catégorie encore inutilisée (variété).
  const picked: typeof scored = [];
  const usedCategories = new Set<string>();
  for (const c of scored) {
    if (picked.length >= total) break;
    if (usedCategories.has(c.food.categorie)) continue;
    usedCategories.add(c.food.categorie);
    picked.push(c);
  }
  // 2e passe : complète avec les meilleurs restants.
  for (const c of scored) {
    if (picked.length >= total) break;
    if (!picked.includes(c)) picked.push(c);
  }
  // Garantit au moins un aliment déjà mangé dans la première page.
  ensureKnownInFirstPage(picked, scored, ctx.consumedIds, MACRO_MAX_SUGGESTIONS);

  return picked.map(({ food, portionG, prot, kcal }) => ({ food, portionG, prot, kcal }));
}

// ---------------------------------------------------------------------------
// Libellés courts (badges compacts, mobile)
// ---------------------------------------------------------------------------

const SHORT_LABELS: Partial<Record<NutrientKey, string>> = {
  proteines: 'Prot.', glucides: 'Gluc.', lipides: 'Lip.', fibres: 'Fibres',
  agSatures: 'AG sat.', agMonoInsatures: 'AGMI', agPolyInsatures: 'AGPI',
  omega3: 'ω3', omega6: 'ω6', omega9: 'ω9',
  magnesium: 'Mg', potassium: 'K', calcium: 'Ca', sodium: 'Na', fer: 'Fer', zinc: 'Zn',
  selenium: 'Se', iode: 'Iode',
  vitA: 'Vit A', vitC: 'Vit C', vitD: 'Vit D', vitE: 'Vit E', vitK1: 'K1', vitK2: 'K2',
  vitB1: 'B1', vitB2: 'B2', vitB3: 'B3', vitB5: 'B5', vitB6: 'B6', vitB9: 'B9', vitB12: 'B12',
  creatine: 'Créatine', collagene: 'Collag.',
};

export function shortLabel(key: NutrientKey, fallback: string): string {
  return SHORT_LABELS[key] ?? fallback;
}
