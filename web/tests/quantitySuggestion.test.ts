import { describe, expect, it } from 'vitest';
import { suggestQuantity } from '../src/nutrition/quantitySuggestion';
import { EMPTY_NUTRIENTS, type Unit } from '../src/nutrition/types';
import type { JournalEntry } from '../src/store/store';

const date = '2026-10-23';
function history(choices: [number, Unit][]): JournalEntry[] {
  return choices.map(([quantite, unite], index) => ({
    id: String(index), date, createdAt: index, source: 'manuel', transcript: '',
    items: [{ id: String(index), foodId: 'banane', nomAffiche: 'Banane', quantite, unite,
      grams: 100, nutrients: EMPTY_NUTRIENTS, estimation: false, douteux: false }],
  }));
}
const pieces = (n: number): [number, Unit][] => Array.from({ length: n }, () => [2, 'piece']);

describe('suggestQuantity', () => {
  it('leaves catalogue defaults to the caller for a new food', () => {
    expect(suggestQuantity([], 'banane', date)).toBeNull();
    expect(suggestQuantity(history(pieces(5)), 'pomme', date)).toBeNull();
  });
  it('remembers quantity and unit together, including fractions and supplement doses', () => {
    for (const choice of [[1.5, 'piece'], [180, 'g'], [25, 'µg'], [200, 'ml']] as [number, Unit][]) {
      expect(suggestQuantity(history([choice]), 'banane', date)).toMatchObject({ quantite: choice[0], unite: choice[1], reason: 'latest' });
    }
  });
  it('keeps a strong habit through one exception and exposes that exception as an alternative', () => {
    expect(suggestQuantity(history([...pieces(7), [150, 'g']]), 'banane', date)).toEqual({
      quantite: 2, unite: 'piece', reason: 'habit', latest: { quantite: 150, unite: 'g' },
    });
  });
  it('detects a new habit after two identical recent choices, including a unit change', () => {
    expect(suggestQuantity(history([...pieces(8), [150, 'g'], [150, 'g']]), 'banane', date))
      .toMatchObject({ quantite: 150, unite: 'g', reason: 'latest' });
  });
  it('uses the latest choice when evidence is insufficient or habits are mixed', () => {
    for (const choices of [[...pieces(3), [150, 'g']], [...pieces(5), [100, 'g'], [120, 'g'], [150, 'g']]] as [number, Unit][][]) {
      expect(suggestQuantity(history(choices), 'banane', date)).toMatchObject({ quantite: 150, unite: 'g', reason: 'latest' });
    }
  });
  it('limits habit evidence to ten occurrences and ninety days', () => {
    expect(suggestQuantity(history([...pieces(100), ...Array.from({ length: 10 }, (_, i): [number, Unit] => [100 + i, 'g'])]), 'banane', date))
      .toMatchObject({ quantite: 109, reason: 'latest' });
    const entries = history([...pieces(8), [150, 'g']]);
    entries.slice(0, 8).forEach((entry) => { entry.date = '2026-01-01'; });
    expect(suggestQuantity(entries, 'banane', date)).toMatchObject({ quantite: 150, reason: 'latest' });
    expect(suggestQuantity(entries.slice(0, 1), 'banane', date)).toMatchObject({ quantite: 2, reason: 'latest' });
  });
  it('orders by consumption date then entry time, independently of array order', () => {
    const entries = history([[120, 'g'], [2, 'piece']]);
    entries[0].createdAt = 1000;
    entries[0].date = '2026-10-22';
    expect(suggestQuantity(entries.reverse(), 'banane', date)).toMatchObject({ quantite: 2, unite: 'piece' });
    entries[0].date = '2026-10-24';
    expect(suggestQuantity(entries, 'banane', date)).toMatchObject({ quantite: 120, unite: 'g' });
  });
  it('ignores invalid, estimated and uncertain quantities', () => {
    const entries = history([[2, 'piece'], [0, 'g'], [-1, 'g'], [NaN, 'g'], [Infinity, 'g'], [3, 'invalid' as Unit], [250, 'g'], [350, 'g']]);
    entries[6].items[0].estimation = true;
    entries[7].items[0].douteux = true;
    expect(suggestQuantity(entries, 'banane', date)).toMatchObject({ quantite: 2, unite: 'piece' });
  });
  it('uses the last item when an entry contains the same food twice', () => {
    const entries = history([[2, 'piece'], [150, 'g']]);
    entries[0].items.push(entries[1].items[0]);
    expect(suggestQuantity(entries.slice(0, 1), 'banane', date)).toMatchObject({ quantite: 150, unite: 'g' });
  });
});
