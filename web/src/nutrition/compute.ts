import type { ComputedItem, ExtractedItem, Food, Nutrients, NutrientKey, Unit } from './types';
import { EMPTY_NUTRIENTS } from './types';
import { matchFood } from './match';
import type { RecentCounts } from './match';

/** Conversions génériques unité → grammes, si l'aliment n'a pas de surcharge. */
const DEFAULT_UNIT_GRAMS: Record<Unit, number> = {
  g: 1,
  mg: 0.001,
  µg: 0.000001,
  ml: 1, // approximation densité 1
  piece: 100,
  portion: 150,
  cas: 15,
  cac: 5,
  bol: 250,
  verre: 200,
  assiette: 300,
  tranche: 30,
  poignee: 30,
  carre: 10,
  pot: 125,
  pincee: 0.4, // une pincée de sel ≈ 0,4 g
  dose: 5, // dose/dosette générique (poudres, compléments) ≈ 5 g
};

/** Convertit (quantité, unité) en grammes pour un aliment donné. */
export function toGrams(item: ExtractedItem, food: Food | null): number {
  const { quantite, unite } = item;
  if (unite === 'g' || unite === 'ml') return quantite;
  // mg/µg : masse littérale. Sur les compléments « élément pur » (cf. foods.ts),
  // 300 mg de magnésium = 300 mg de magnésium élément dans le bilan.
  if (unite === 'mg') return quantite / 1000;
  if (unite === 'µg') return quantite / 1_000_000;
  const perUnit =
    food?.unitGrams?.[unite] ??
    (unite === 'piece' || unite === 'pot' ? food?.pieceGrams : undefined) ??
    DEFAULT_UNIT_GRAMS[unite];
  return quantite * perUnit;
}

export function scaleNutrients(n: Nutrients, grams: number): Nutrients {
  const factor = grams / 100;
  const out = { ...EMPTY_NUTRIENTS };
  // `?? 0` : un snapshot persisté peut manquer des clés ajoutées depuis (sinon NaN).
  for (const k of Object.keys(out) as NutrientKey[]) out[k] = (n[k] ?? 0) * factor;
  return out;
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = { ...EMPTY_NUTRIENTS };
  for (const k of Object.keys(out) as NutrientKey[]) out[k] = (a[k] ?? 0) + (b[k] ?? 0);
  return out;
}

/**
 * Au-dessus de ce score de match, l'aliment de la base est réputé désigner LE
 * MÊME aliment que celui estimé par l'IA (correspondance quasi exacte) : la base
 * prime alors. En-dessous (simple recoupement de mots), c'est l'estimation IA qui
 * prime — un plat (« gâteau au chocolat noir ») ne doit pas être écrasé par un de
 * ses ingrédients présents en base (« chocolat noir »).
 */
const STRONG_DB_MATCH = 0.9;

/** Construit un aliment synthétique à partir d'une estimation IA (hors base). */
export function iaEstimatedFood(extracted: ExtractedItem): Food | null {
  if (!extracted.nutriments) return null;
  const g = extracted.grammesParPiece;
  return {
    id: 'ia-estime',
    nom: extracted.aliment,
    categorie: extracted.categorie ?? 'autre',
    aliases: [],
    pieceGrams: g,
    // grammesParPiece vaut pour une pièce OU une portion (cf. ESTIMATION_PROMPT).
    ...(g ? { unitGrams: { portion: g } } : {}),
    n: extracted.nutriments,
  };
}

/** Matche + convertit + calcule chaque item extrait contre les aliments effectifs. */
export function computeItems(items: ExtractedItem[], foods: Food[], recentCounts?: RecentCounts): ComputedItem[] {
  return items.map((extracted) => {
    const match = matchFood(extracted.aliment, foods, recentCounts);
    // Estimation IA (aliment hors base) : le modèle n'attache des nutriments que
    // pour un aliment spécifique/composé qu'il juge hors base générique — on honore
    // alors SON estimation. La base ne l'emporte que sur un match QUASI EXACT ;
    // un simple recoupement de mots ne doit pas écraser l'estimation.
    const iaFood = iaEstimatedFood(extracted);
    const strongDbMatch = !!match.food && !match.douteux && match.score >= STRONG_DB_MATCH;
    if (iaFood && !strongDbMatch) {
      const grams = toGrams(extracted, iaFood);
      return {
        extracted,
        match: { food: null, score: 0, douteux: false, alternatives: match.alternatives },
        grams,
        nutrients: scaleNutrients(iaFood.n, grams),
        aiEstime: true,
      };
    }
    const grams = toGrams(extracted, match.food);
    return {
      extracted,
      match,
      grams,
      nutrients: match.food ? scaleNutrients(match.food.n, grams) : null,
    };
  });
}

export function totalNutrients(items: ComputedItem[]): Nutrients {
  return items.reduce((acc, it) => (it.nutrients ? addNutrients(acc, it.nutrients) : acc), {
    ...EMPTY_NUTRIENTS,
  });
}
