import type { Food, FoodPrice } from './types';
import type { JournalEntry, JournalItem } from '../store/store';
import { FOOD_BY_ID } from './foods';

export const PRICE_NOTE = 'Estimation France, région parisienne';

export function validFoodPrice(value: unknown): FoodPrice | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<FoodPrice>;
  if (typeof p.eurPerKg !== 'number' || !Number.isFinite(p.eurPerKg) || p.eurPerKg <= 0) return null;
  if (p.confidence !== 'faible' && p.confidence !== 'moyenne' && p.confidence !== 'forte') return null;
  if (typeof p.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return null;
  if (p.origin !== 'releve' && p.origin !== 'ia' && p.origin !== 'manuel') return null;
  return p as FoodPrice;
}

export function estimatedPrice(eurPerKg: number | undefined, confidence: FoodPrice['confidence'] = 'faible', date = new Date().toISOString().slice(0, 10)): FoodPrice | null {
  return validFoodPrice({ eurPerKg, confidence, date, origin: 'ia' });
}

export interface DayCost {
  knownEur: number;
  pricedItems: number;
  contributions: { name: string; eur: number }[];
  missingNames: string[];
  complete: boolean;
}

/** Le journal ne fige pas le prix : une correction de fiche réévalue aussi le passé. */
export function costOfItems(items: JournalItem[], foods: Food[]): DayCost {
  const byId = new Map(foods.map((f) => [f.id, f]));
  let knownEur = 0;
  let pricedItems = 0;
  const contributions: { name: string; eur: number }[] = [];
  const missingNames: string[] = [];
  for (const item of items) {
    if (item.id === 'sun-day') continue;
    const food = item.foodId ? byId.get(item.foodId) ?? FOOD_BY_ID.get(item.foodId) : undefined;
    const price = validFoodPrice(food?.price);
    if (!price || !Number.isFinite(item.grams) || item.grams <= 0) {
      missingNames.push(item.nomAffiche);
      continue;
    }
    const eur = item.grams * price.eurPerKg / 1000;
    knownEur += eur;
    contributions.push({ name: item.nomAffiche, eur });
    pricedItems++;
  }
  return { knownEur, pricedItems, contributions, missingNames, complete: missingNames.length === 0 };
}

export function costOfDay(entries: JournalEntry[], foods: Food[]): DayCost {
  return costOfItems(entries.flatMap((entry) => entry.items), foods);
}

/** Base 100 % des Stats : moyenne des seuls jours entièrement chiffrés. */
export function meanCompleteCosts(rows: { cost: DayCost; weight: number }[]): number | null {
  const complete = rows.filter(({ cost, weight }) => cost.complete && Number.isFinite(weight) && weight > 0);
  const weightSum = complete.reduce((sum, row) => sum + row.weight, 0);
  if (!weightSum) return null;
  const mean = complete.reduce((sum, row) => sum + row.cost.knownEur * row.weight, 0) / weightSum;
  return mean > 0 ? mean : null;
}
