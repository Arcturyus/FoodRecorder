import type { ComputedItem, ExtractedItem, Food, Nutrients, NutrientKey, Unit } from './types';
import { EMPTY_NUTRIENTS } from './types';
import { matchFood } from './match';

/** Conversions génériques unité → grammes, si l'aliment n'a pas de surcharge. */
const DEFAULT_UNIT_GRAMS: Record<Unit, number> = {
  g: 1,
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
};

/** Convertit (quantité, unité) en grammes pour un aliment donné. */
export function toGrams(item: ExtractedItem, food: Food | null): number {
  const { quantite, unite } = item;
  if (unite === 'g' || unite === 'ml') return quantite;
  const perUnit =
    food?.unitGrams?.[unite] ??
    (unite === 'piece' || unite === 'pot' ? food?.pieceGrams : undefined) ??
    DEFAULT_UNIT_GRAMS[unite];
  return quantite * perUnit;
}

export function scaleNutrients(n: Nutrients, grams: number): Nutrients {
  const factor = grams / 100;
  const out = { ...EMPTY_NUTRIENTS };
  for (const k of Object.keys(out) as NutrientKey[]) out[k] = n[k] * factor;
  return out;
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = { ...EMPTY_NUTRIENTS };
  for (const k of Object.keys(out) as NutrientKey[]) out[k] = a[k] + b[k];
  return out;
}

/** Matche + convertit + calcule chaque item extrait. */
export function computeItems(items: ExtractedItem[], customFoods: Food[] = []): ComputedItem[] {
  return items.map((extracted) => {
    const match = matchFood(extracted.aliment, customFoods);
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
