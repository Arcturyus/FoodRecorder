import type { JournalEntry, FavoriteMealItem } from '../store/store';
import type { Food } from '../nutrition/types';
import { UNITS } from '../nutrition/types';
import { foodFrequencies } from '../nutrition/frequency';
import { groupIntoMeals } from './meals';

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
    .map((usage) => ({ food: byId.get(usage.foodId!)!, days: usage.jours }));
}

export interface RepeatedMeal {
  key: string;
  nom: string;
  items: FavoriteMealItem[];
  days: number;
  latest: string;
}

/** Recurring food cores, independent of quantities, units and optional extras.
 * Intersections find closed food sets without enumerating every subset of a meal.
 * Each result keeps only its named foods, with the latest matching meal's doses. */
export function repeatedMealShortcuts(entries: JournalEntry[], foods: Food[], date: string): RepeatedMeal[] {
  const range = shortcutRange(date);
  const knownIds = new Set(foods.map((food) => food.id));
  const byDay = new Map<string, JournalEntry[]>();
  for (const entry of entries) {
    if (entry.date < range.start || entry.date > range.end) continue;
    const day = byDay.get(entry.date) ?? [];
    day.push(entry);
    byDay.set(entry.date, day);
  }
  const meals = [...byDay].sort(([a], [b]) => a.localeCompare(b)).flatMap(([day, dayEntries]) =>
    groupIntoMeals(dayEntries).map((meal) => {
      // An estimated portion is still a recorded consumption. Unresolved foods
      // and one-off nutrient overrides cannot safely be reused as bank items.
      const items = meal.entries.flatMap((entry) => entry.items).filter((item) => item.foodId && knownIds.has(item.foodId)
        && !item.customN && !item.douteux && Number.isFinite(item.quantite) && item.quantite > 0 && UNITS.includes(item.unite));
      return { day, items, ids: new Set(items.map((item) => item.foodId!)) };
    }).filter((meal) => meal.ids.size >= 2));

  const candidates = new Map<string, Set<string>>();
  const addCandidate = (ids: Set<string>) => {
    if (ids.size >= 2) candidates.set(JSON.stringify([...ids].sort()), ids);
  };
  for (const meal of meals) {
    const previous = [...candidates.values()];
    for (const ids of previous) addCandidate(new Set([...ids].filter((id) => meal.ids.has(id))));
    addCandidate(meal.ids);
  }
  const supported: (RepeatedMeal & { ids: Set<string>; dates: Set<string> })[] = [];
  for (const [key, ids] of candidates) {
    const matching = meals.filter((meal) => [...ids].every((id) => meal.ids.has(id)));
    const dates = new Set(matching.map((meal) => meal.day));
    if (dates.size < 2) continue;
    const latest = matching[matching.length - 1];
    const items = latest.items.filter((item) => ids.has(item.foodId!))
      .map(({ foodId, nomAffiche, quantite, unite, estimation }) => ({ foodId, nomAffiche, quantite, unite, estimation }));
    const nom = [...new Map(items.map((item) => [item.foodId, item.nomAffiche])).values()].join(', ');
    supported.push({ key, nom, items, days: dates.size, latest: latest.day, ids, dates });
  }
  // Retain a smaller core only when it describes additional consumption days.
  return supported.filter((group) => !supported.some((other) => other.ids.size > group.ids.size
    && other.days === group.days && [...group.dates].every((day) => other.dates.has(day))
    && [...group.ids].every((id) => other.ids.has(id))))
    .sort((a, b) => b.days - a.days || b.latest.localeCompare(a.latest) || b.ids.size - a.ids.size || a.nom.localeCompare(b.nom, 'fr'))
    .map(({ ids: _ids, dates: _dates, ...group }) => group);
}
