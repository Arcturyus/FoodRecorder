import type { Food, FoodPrice } from './types';
import { normalize } from './normalize';
import { PRICE_SEED, PRICE_SEED_DATE, type PriceSeedRow } from './priceSeedData';

const bankRows = new Map<string, PriceSeedRow>();
const catalogueRows = new Map<string, PriceSeedRow>();
/** Libellés du relevé qui décrivent la même référence avec un autre nom. */
const catalogueAliases = new Map([
  [normalize('Salade verte (laitue)'), normalize('Laitue, crue')],
  [normalize('Oméga 3 (capsules huile de poisson)'), normalize('Oméga 3 Nutripure')],
]);
for (const row of PRICE_SEED) {
  (row.scope === 'bank' ? bankRows : catalogueRows).set(normalize(row.name), row);
}

export function seedPriceFor(food: Pick<Food, 'nom' | 'origine' | 'sourceId'>, scope: 'bank' | 'catalogue'): FoodPrice | undefined {
  const name = normalize(food.nom);
  const alias = catalogueAliases.get(name);
  const row = scope === 'catalogue'
    ? catalogueRows.get(name) ?? bankRows.get(name) ?? (alias ? bankRows.get(alias) : undefined)
    : bankRows.get(name) ?? (food.sourceId || food.origine === 'catalogue' ? catalogueRows.get(name) ?? (alias ? bankRows.get(alias) : undefined) : undefined);
  return row ? { eurPerKg: row.eurPerKg, confidence: row.confidence, date: PRICE_SEED_DATE, origin: 'releve' } : undefined;
}

/** Add initial prices to legacy rows without replacing a correction or explicit unknown. */
export function enrichBankPrices(foods: Food[]): Food[] {
  return foods.map((food) => {
    if (food.price !== undefined) return food;
    const price = seedPriceFor(food, 'bank');
    return price ? { ...food, price } : food;
  });
}
