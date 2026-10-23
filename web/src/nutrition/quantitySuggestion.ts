import type { JournalEntry } from '../store/store';
import { UNITS, type Unit } from './types';

export interface QuantityChoice {
  quantite: number;
  unite: Unit;
}

export interface QuantitySuggestion extends QuantityChoice {
  reason: 'latest' | 'habit';
  latest: QuantityChoice;
}

const same = (a: QuantityChoice, b: QuantityChoice) => a.quantite === b.quantite && a.unite === b.unite;

/** Derived only from the journal. Consumption date takes precedence over entry time,
 * so backfilling an old meal does not become the latest habit. */
export function suggestQuantity(entries: JournalEntry[], foodId: string, date: string): QuantitySuggestion | null {
  const history = entries.filter((entry) => entry.date <= date)
    .flatMap((entry) => entry.items.map((item, index) => ({ ...item, date: entry.date, createdAt: entry.createdAt, index })))
    .filter((item) => item.foodId === foodId && Number.isFinite(item.quantite) && item.quantite > 0
      && UNITS.includes(item.unite) && !item.estimation && !item.douteux)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt || b.index - a.index);
  if (!history.length) return null;
  const latest: QuantityChoice = { quantite: history[0].quantite, unite: history[0].unite };
  const fallback: QuantitySuggestion = { ...latest, latest, reason: 'latest' };
  const cutoff = new Date(`${date}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);
  const recent = history.filter((item) => item.date >= cutoff.toISOString().slice(0, 10)).slice(0, 10);
  // Two identical recent choices establish a new habit immediately.
  if (recent.length < 5 || same(recent[0], recent[1])) return fallback;
  const counts = new Map<string, { choice: QuantityChoice; count: number }>();
  for (const item of recent) {
    const key = `${item.quantite}|${item.unite}`;
    const group = counts.get(key) ?? { choice: { quantite: item.quantite, unite: item.unite }, count: 0 };
    group.count++;
    counts.set(key, group);
  }
  const habit = [...counts.values()].find((group) => group.count / recent.length >= 0.7);
  return habit && !same(habit.choice, latest)
    ? { ...habit.choice, latest, reason: 'habit' }
    : fallback;
}
