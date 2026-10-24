import { beforeEach, describe, expect, it } from 'vitest';
import { frequentFoodShortcuts, repeatedMealShortcuts, shortcutRange } from '../src/ui/recentShortcuts';
import { FOOD_BY_ID } from '../src/nutrition/foods';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import { useStore, type JournalEntry } from '../src/store/store';

const banana = FOOD_BY_ID.get('banane')!;
const apple = FOOD_BY_ID.get('pomme')!;
const foods = [banana, apple];
const date = '2026-10-23';
function entry(day: string, ids = ['banane', 'pomme'], createdAt = 1): JournalEntry {
  return { id: `${day}-${createdAt}`, date: day, createdAt, transcript: '', source: 'manuel', items: ids.map((foodId, i) => ({
    id: `${foodId}-${i}`, foodId, nomAffiche: FOOD_BY_ID.get(foodId)?.nom ?? foodId, quantite: 2, unite: 'piece',
    grams: 240, nutrients: EMPTY_NUTRIENTS, estimation: false, douteux: false,
  })) };
}

describe('fifteen-day shortcuts', () => {
  it('keeps more than four foods and combinations available for scrolling', () => {
    const bank = Array.from({ length: 7 }, (_, i) => ({ ...banana, id: `food-${i}` }));
    const entries = ['2026-10-22', date].flatMap((day) => bank.map((food, i) => {
      const meal = entry(day, [food.id, bank[(i + 1) % bank.length].id], i * 4_000_000);
      return meal;
    }));
    expect(frequentFoodShortcuts(entries, bank, date)).toHaveLength(7);
    expect(repeatedMealShortcuts(entries, bank, date)).toHaveLength(7);
  });
  it('includes exactly fifteen calendar days, across month boundaries', () => {
    expect(shortcutRange(date)).toEqual({ start: '2026-10-09', end: date });
    expect(shortcutRange('2026-03-05')).toEqual({ start: '2026-02-19', end: '2026-03-05' });
  });
  it('ranks by distinct days before occurrence counts; excludes old, future, unknown and one-day foods', () => {
    const entries = [entry('2026-10-09', ['banane']), entry(date, ['banane']), entry(date, Array(20).fill('pomme')),
      entry('2026-10-08', ['pomme']), entry('2026-10-24', ['pomme']), entry(date, ['missing']), entry('2026-10-22', ['missing'])];
    expect(frequentFoodShortcuts(entries, foods, date).map((s) => [s.food.id, s.days])).toEqual([['banane', 2]]);
    entries.push(entry('2026-10-22', ['pomme']));
    expect(frequentFoodShortcuts(entries, foods, date).map((s) => s.food.id)).toEqual(['pomme', 'banane']);
  });
  it('recognizes exact meals regardless of item order or entry splitting', () => {
    const entries = [entry('2026-10-09'), entry(date, ['pomme'], 1), entry(date, ['banane'], 2)];
    const shortcuts = repeatedMealShortcuts(entries, foods, date);
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]).toMatchObject({ days: 2, latest: date });
    expect(shortcuts[0].items.map((item) => item.foodId)).toEqual(['pomme', 'banane']);
  });
  it('does not turn repeated entries from one day into a recurring meal', () => {
    expect(repeatedMealShortcuts([entry(date), entry(date, ['banane', 'pomme'], 4_000_000)], foods, date)).toEqual([]);
  });
  it('honors meal boundaries and does not mix dates', () => {
    const entries = [entry('2026-10-22'), entry(date, ['banane'], 1), { ...entry(date, ['pomme'], 2), mealLink: 'break' as const }];
    expect(repeatedMealShortcuts(entries, foods, date)).toEqual([]);
    expect(repeatedMealShortcuts([entry('2026-10-08'), entry('2026-10-24'), entry(date)], foods, date)).toEqual([]);
  });
  it('recognizes changing doses and units and reuses the latest values', () => {
    const latest = entry(date);
    Object.assign(latest.items[0], { quantite: 150, unite: 'g', estimation: true });
    const result = repeatedMealShortcuts([latest, entry('2026-10-22')], foods, date);
    expect(result).toHaveLength(1);
    expect(result[0].items[0]).toMatchObject({ foodId: 'banane', quantite: 150, unite: 'g', estimation: true });
  });
  it('keeps unsafe items out of reusable combinations', () => {
    for (const patch of [{ douteux: true }, { foodId: null }, { customN: EMPTY_NUTRIENTS }, { quantite: NaN }]) {
      const altered = entry(date);
      Object.assign(altered.items[0], patch);
      expect(repeatedMealShortcuts([entry('2026-10-22'), altered], foods, date)).toEqual([]);
    }
  });
  it('finds a recurring core despite different extras and does not copy those extras', () => {
    const bank = [...foods, { ...banana, id: 'extra-a' }, { ...banana, id: 'extra-b' }];
    const result = repeatedMealShortcuts([entry('2026-10-22', ['banane', 'pomme', 'extra-a']), entry(date, ['pomme', 'banane', 'extra-b'])], bank, date);
    expect(result).toHaveLength(1);
    expect(result[0].days).toBe(2);
    expect(result[0].items.map((item) => item.foodId)).toEqual(['pomme', 'banane']);
  });
  it('suppresses redundant subsets, but retains a core seen on more days', () => {
    const bank = [...foods, { ...banana, id: 'extra' }];
    const entries = [entry('2026-10-21', ['banane', 'pomme', 'extra']), entry('2026-10-22', ['banane', 'pomme', 'extra'])];
    expect(repeatedMealShortcuts(entries, bank, date).map((s) => s.items.length)).toEqual([3]);
    entries.push(entry(date));
    const results = repeatedMealShortcuts(entries, bank, date);
    expect(results.map((s) => [s.days, s.items.length])).toEqual([[3, 2], [2, 3]]);
  });
  it('finds intersections requiring more than two meals', () => {
    const bank = [...foods, ...['c', 'd', 'e'].map((id) => ({ ...banana, id }))];
    const entries = [entry('2026-10-21', ['banane', 'pomme', 'c', 'd']), entry('2026-10-22', ['banane', 'pomme', 'c', 'e']), entry(date, ['banane', 'pomme', 'd', 'e'])];
    expect(repeatedMealShortcuts(entries, bank, date)[0]).toMatchObject({ days: 3 });
    expect(repeatedMealShortcuts(entries, bank, date)[0].items.map((i) => i.foodId)).toEqual(['banane', 'pomme']);
  });
  it('does not form a combination from two occurrences of a single food', () => {
    expect(repeatedMealShortcuts([entry('2026-10-22', ['banane', 'banane']), entry(date, ['banane', 'banane'])], foods, date)).toEqual([]);
  });
});

describe('reusing a meal without saving a favorite', () => {
  beforeEach(() => useStore.setState({ entries: [], customFoods: foods, favoriteMeals: [] }));
  it('creates one entry on the target day, with current nutrients, fresh ids and exact units', () => {
    const items = entry(date).items;
    const id = useStore.getState().addMealItems('Repas récurrent', items, '2026-10-20');
    const saved = useStore.getState().entries[0];
    expect(saved.id).toBe(id);
    expect(saved.date).toBe('2026-10-20');
    expect(saved.items).toHaveLength(2);
    expect(saved.items[0].id).not.toBe(items[0].id);
    expect(saved.items[0].grams).toBe(240);
    expect(saved.items[0].nutrients.kcal).toBeCloseTo(banana.n.kcal * 2.4);
    expect(useStore.getState().favoriteMeals).toEqual([]);
  });
  it('rejects empty or invalid meals atomically', () => {
    expect(useStore.getState().addMealItems('empty', [])).toBeNull();
    const items = entry(date).items;
    items[1].quantite = NaN;
    expect(useStore.getState().addMealItems('invalid', items)).toBeNull();
    expect(useStore.getState().entries).toEqual([]);
  });
});
