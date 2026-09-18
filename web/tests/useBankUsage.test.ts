import { describe, expect, it } from 'vitest';
import { buildBankUsage } from '../src/ui/useBankUsage';
import type { JournalEntry, JournalItem } from '../src/store/store';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';

function item(quantite?: number, unite?: JournalItem['unite']): JournalItem {
  return {
    id: `${quantite ?? 'legacy'}-${unite ?? 'legacy'}`,
    foodId: 'banane',
    nomAffiche: 'Banane',
    quantite: quantite as number,
    unite: unite as JournalItem['unite'],
    grams: 100,
    nutrients: { ...EMPTY_NUTRIENTS, kcal: 90 },
    estimation: false,
    douteux: false,
  };
}

function entry(date: string, createdAt: number, itemValue: JournalItem): JournalEntry {
  return { id: `${date}-${createdAt}`, date, createdAt, transcript: '', source: 'manuel', items: [itemValue] };
}

describe('buildBankUsage', () => {
  it('retient les trois dernières quantités dans l’ordre chronologique inverse', () => {
    const usage = buildBankUsage([
      entry('2026-03-01', 1, item(120, 'g')),
      entry('2026-03-05', 1, item(1, 'piece')),
      entry('2026-03-05', 2, item(2, 'piece')),
      entry('2026-03-07', 1, item(150, 'g')),
    ]).get('banane');

    expect(usage?.recent).toEqual([
      { date: '2026-03-07', quantite: 150, unite: 'g' },
      { date: '2026-03-05', quantite: 2, unite: 'piece' },
      { date: '2026-03-05', quantite: 1, unite: 'piece' },
    ]);
  });

  it('garde la date mais omet la quantité d’une ancienne ligne incomplète', () => {
    const usage = buildBankUsage([
      entry('2026-03-01', 1, item()),
      entry('2026-03-02', 1, item(100, 'g')),
    ]).get('banane');

    expect(usage?.recent).toEqual([
      { date: '2026-03-02', quantite: 100, unite: 'g' },
      { date: '2026-03-01' },
    ]);
  });
});
