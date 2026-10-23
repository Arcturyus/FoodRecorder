import type { JournalEntry, FavoriteMealItem } from '../store/store';
import type { Food } from '../nutrition/types';
import { UNITS } from '../nutrition/types';
import { foodFrequencies } from '../nutrition/frequency';
import { groupIntoMeals, mealSummary } from './meals';

export function shortcutRange(date: string) {
  const start = new Date(`${date}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 14);
  return { start: start.toISOString().slice(0, 10), end: date };
}

export function frequentFoodShortcuts(entries: JournalEntry[], foods: Food[], date: string) {
  const byId = new Map(foods.map((food) => [food.id, food]));
  return foodFrequencies(entries, shortcutRange(date))
    .filter((usage) => usage.foodId && byId.has(usage.foodId) && usage.jours >= 2)
    .sort((a, b) => b.jours - a.jours || b.occurrences - a.occurrences || b.derniere.localeCompare(a.derniere) || a.nom.localeCompare(b.nom, 'fr'))
    .slice(0, 4).map((usage) => ({ food: byId.get(usage.foodId!)!, days: usage.jours }));
}

export interface RepeatedMeal {
  key: string;
  nom: string;
  items: FavoriteMealItem[];
  days: number;
  latest: string;
}

/** Exact composition + doses, independent of entry/item order. Whole meals only:
 * unresolved items or one-off nutrient overrides must never be silently omitted. */
export function repeatedMealShortcuts(entries: JournalEntry[], foods: Food[], date: string): RepeatedMeal[] {
  const range = shortcutRange(date);
  const ids = new Set(foods.map((food) => food.id));
  const days = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    if (entry.date < range.start || entry.date > range.end) continue;
    days.set(entry.date, [...(days.get(entry.date) ?? []), entry]);
  }
  const groups = new Map<string, RepeatedMeal & { dates: Set<string> }>();
  for (const [day, dayEntries] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    for (const meal of groupIntoMeals(dayEntries)) {
      const items = meal.entries.flatMap((entry) => entry.items);
      if (items.length < 2 || items.some((item) => !item.foodId || !ids.has(item.foodId) || item.customN
        || item.estimation || item.douteux || !Number.isFinite(item.quantite) || item.quantite <= 0 || !UNITS.includes(item.unite))) continue;
      const key = JSON.stringify(items.map((item) => [item.foodId, item.quantite, item.unite]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
      const group = groups.get(key) ?? { key, nom: '', items: [], days: 0, latest: day, dates: new Set<string>() };
      group.nom = mealSummary(meal);
      group.items = items.map(({ foodId, nomAffiche, quantite, unite, estimation }) => ({ foodId, nomAffiche, quantite, unite, estimation }));
      group.latest = day;
      group.dates.add(day);
      group.days = group.dates.size;
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter((group) => group.days >= 2)
    .sort((a, b) => b.days - a.days || b.latest.localeCompare(a.latest) || a.nom.localeCompare(b.nom, 'fr'))
    .slice(0, 4).map(({ dates: _dates, ...group }) => group);
}
