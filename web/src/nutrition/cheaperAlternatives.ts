import { NUTRIENT_GROUPS } from './groups';
import { RDA } from './rda';
import { validFoodPrice } from './price';
import type { Food, NutrientKey } from './types';

export interface CheaperAlternative {
  food: Food;
  savingEurKg: number;
  savingPercent: number;
  distance: number;
  differences: { key: NutrientKey; from: number; to: number }[];
}

/** Compare les quantités par 100 g, en équilibrant macros, lipides, minéraux,
 * vitamines et autres. Les sous-détails d'un nutriment sont exclus. */
export function cheaperAlternatives(source: Food, foods: Food[], sameCategory = true, limit = 5): CheaperAlternative[] {
  const sourcePrice = validFoodPrice(source.price)?.eurPerKg;
  if (!sourcePrice) return [];
  const keys = RDA.filter((r) => !r.parent).map((r) => r.key);
  const eligible = foods.filter((food) => {
    const price = validFoodPrice(food.price)?.eurPerKg;
    return food.id !== source.id && food.categorie !== 'supplement' &&
      (!sameCategory || food.categorie === source.categorie) && price !== undefined && price < sourcePrice;
  });
  const scales = new Map(keys.map((key) => {
    const values = foods.map((f) => f.n[key]).filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
    return [key, values[Math.floor((values.length - 1) * 0.95)] || 1] as const;
  }));
  const groups = NUTRIENT_GROUPS.map((group) => group.keys.filter((key) => keys.includes(key)));
  const difference = (a: Food, b: Food, key: NutrientKey) => {
    const scale = scales.get(key) || 1;
    return Math.abs(Math.log1p(Math.max(0, a.n[key]) / scale) - Math.log1p(Math.max(0, b.n[key]) / scale));
  };
  return eligible.map((food) => {
    const groupErrors = groups.filter((group) => group.length).map((group) =>
      group.reduce((sum, key) => sum + difference(source, food, key) ** 2, 0) / group.length);
    const price = validFoodPrice(food.price)!.eurPerKg;
    return {
      food,
      savingEurKg: sourcePrice - price,
      savingPercent: (sourcePrice - price) / sourcePrice * 100,
      distance: Math.sqrt(groupErrors.reduce((sum, value) => sum + value, 0) / groupErrors.length),
      differences: keys.map((key) => ({ key, from: source.n[key], to: food.n[key], magnitude: difference(source, food, key) }))
        .sort((a, b) => b.magnitude - a.magnitude).slice(0, 3)
        .map(({ key, from, to }) => ({ key, from, to })),
    };
  }).sort((a, b) => a.distance - b.distance || b.savingEurKg - a.savingEurKg).slice(0, limit);
}
