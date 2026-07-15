import { describe, expect, it } from 'vitest';
import { movingAverage } from '../src/ui/Stats';
import { computeRatio, RATIOS } from '../src/nutrition/ratios';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';

describe('moyenne mobile des rapports', () => {
  it('moyenne glissante trailing sur la fenêtre demandée', () => {
    // fenêtre 3 : chaque point = moyenne des ≤ 3 dernières valeurs
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([1, 1.5, 2, 3, 4]);
  });

  it('ignore les jours sans donnée (null) dans la fenêtre', () => {
    // fenêtre 3 sur [2, null, 4] : dernier point = (2 + 4) / 2 = 3
    const out = movingAverage([2, null, 4], 3);
    expect(out[0]).toBe(2);
    expect(out[1]).toBe(2); // seule valeur définie de la fenêtre
    expect(out[2]).toBe(3);
  });

  it('renvoie null quand aucune valeur n\'est définie dans la fenêtre', () => {
    expect(movingAverage([null, null], 2)).toEqual([null, null]);
  });

  it('les rapports se calculent bien sur des totaux journaliers', () => {
    const o6o3 = RATIOS.find((r) => r.key === 'o6o3')!;
    const totals = { ...EMPTY_NUTRIENTS, omega6: 12, omega3: 3 };
    expect(computeRatio(o6o3, totals).value).toBeCloseTo(4, 5);
    // dénominateur nul → rapport indéfini (null), ignoré par la moyenne mobile
    expect(computeRatio(o6o3, { ...EMPTY_NUTRIENTS, omega6: 5, omega3: 0 }).value).toBeNull();
  });
});
