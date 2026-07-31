/**
 * kcal superposées à la courbe de poids : la règle « jours enregistrés
 * seulement, sauf jeûne » est le cœur du sujet — un jour vide compté à 0
 * écraserait la courbe et ferait croire à une chute des apports.
 */

import { describe, expect, it } from 'vitest';
import { dailyKcalPoints } from '../src/ui/WeightChart';

/** Journal minimal : un jour, un total kcal. */
function jour(date: string, kcal: number) {
  return { date, items: [{ nutrients: { kcal } }] };
}

const range = { start: '2026-07-01', end: '2026-07-05' };

describe('dailyKcalPoints', () => {
  it('ignore les jours vides (non remplis), ne les compte pas à 0', () => {
    const pts = dailyKcalPoints([jour('2026-07-01', 2000), jour('2026-07-04', 2400)], {}, range);
    expect(pts.map((p) => p.value)).toEqual([2000, 2400]);
  });

  it('compte 0 pour un jour vide marqué « compté » (jeûne)', () => {
    const pts = dailyKcalPoints([jour('2026-07-01', 2000)], { '2026-07-03': false }, range);
    expect(pts.map((p) => p.value)).toEqual([2000, 0]);
  });

  it('ignore un jour muté même s’il contient des entrées (jour mal rempli)', () => {
    const pts = dailyKcalPoints(
      [jour('2026-07-01', 2000), jour('2026-07-02', 300), jour('2026-07-03', 2200)],
      { '2026-07-02': true },
      range,
    );
    expect(pts.map((p) => p.value)).toEqual([2000, 2200]);
  });

  it('additionne les repas d’un même jour', () => {
    const pts = dailyKcalPoints([jour('2026-07-02', 700), jour('2026-07-02', 1300)], {}, range);
    expect(pts.map((p) => p.value)).toEqual([2000]);
  });

  it('reste dans la plage demandée', () => {
    const pts = dailyKcalPoints([jour('2026-06-28', 1800), jour('2026-07-02', 2000), jour('2026-07-09', 2500)], {}, range);
    expect(pts.map((p) => p.value)).toEqual([2000]);
  });
});
