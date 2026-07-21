import type { Food, Nutrients, NutrientKey } from './types';
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
/** Nombre d'aliments suggérés par alerte (déficit/ratio). */
const DAY_FOOD_SUGGESTIONS = 4;

/**
 * Meilleures sources d'un nutriment, par portion habituelle, cappées au besoin
 * restant. Diversifie les catégories d'aliments (pas 4 poissons d'affilée) et,
 * si possible, inclut au moins un aliment déjà consommé par l'utilisateur —
 * plus actionnable qu'une source jamais essayée.
 */
export function topSourcesFor(
  key: NutrientKey,
  need: number,
  foods: Food[],
  opts: {
    supplements: boolean;
    limit: number;
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

  // Garantit au moins un aliment déjà mangé, si l'un des candidats l'est.
  if (opts.consumedIds && picked.length > 0 && !picked.some((s) => opts.consumedIds!.has(s.food.id))) {
    const known = candidates.find((c) => opts.consumedIds!.has(c.food.id));
    if (known) picked[picked.length - 1] = known;
  }

  return picked;
}

/** Options communes des suggestions d'aliments (déjà consommés inclus, variété). */
function foodOpts(consumedIds: Set<string>, extra: Partial<Parameters<typeof topSourcesFor>[3]> = {}) {
  return { supplements: false, limit: DAY_FOOD_SUGGESTIONS, consumedIds, ...extra };
}

/**
 * Alertes « choquantes » de la journée en cours : plafonds déjà dépassés,
 * rapports hors zone, nutriments très en retard sur le rythme du jour
 * (couverture rapportée à l'avancement calorique, pour ne pas tout signaler au
 * petit-déjeuner). Chaque alerte est notée par sévérité (0..~2+) pour prioriser
 * les 6 plus parlantes si tout ne tient pas. Renvoie [] tant que la journée est
 * trop peu avancée.
 */
export function dayAdvice(
  totals: Nutrients,
  targets: Target[],
  foods: Food[],
  consumedIds: Set<string> = new Set(),
  importance: ImportanceFn = NEUTRAL_IMPORTANCE,
): DayAdviceItem[] {
  const kcalT = targets.find((t) => t.key === 'kcal');
  if (!kcalT || kcalT.optimal <= 0) return [];
  const progress = totals.kcal / kcalT.optimal;
  if (progress < DAY_MIN_PROGRESS) return [];
  const p = Math.min(1, progress);

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
        text: `${t.label} : ${Math.round((v / t.ajr) * 100)} % du plafond journalier déjà atteint — évitez d'en rajouter d'ici ce soir.`,
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
      text = `Rapport ${def.label} à ${r.text} (idéal ≤ ${def.optimal}:1) : trop d'oméga-6 pour vos oméga-3 — il faudrait environ ${roundNeed(need)} g d'oméga-3 en plus aujourd'hui (ou moins d'huiles riches en ω6).`;
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
  const lagging = targets
    .filter((t) => t.goal === 'atLeast' && t.key !== 'kcal' && t.optimal > 0 && importance(t.key) > 0)
    .map((t) => ({ t, relCov: totals[t.key] / t.optimal / p }))
    .filter(({ relCov }) => relCov < DAY_LAG_THRESHOLD);

  for (const { t, relCov } of lagging) {
    const need = t.optimal - totals[t.key];
    scored.push({
      rank: 100 * (1 - relCov) * importance(t.key),
      item: {
        kind: 'deficit',
        target: t,
        text: `${t.label} : ${Math.round(relCov * 100)} % du rythme attendu — il manque encore ${roundNeed(need)} ${t.unit} d'ici ce soir.`,
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

function roundNeed(v: number): number {
  if (v >= 100) return Math.round(v / 10) * 10;
  if (v >= 10) return Math.round(v);
  return Math.round(v * 10) / 10;
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
