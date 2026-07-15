import { describe, expect, it } from 'vitest';
import { scaleLinear, scaleLog } from 'd3-scale';
import { rescaleAxis } from '../src/ui/FoodExplorer';

describe('rescaleAxis', () => {
  it('identité (k=1, t=0) laisse le domaine inchangé', () => {
    const base = scaleLinear().domain([0, 100]).range([0, 200]);
    const v = rescaleAxis(base, { k: 1, t: 0 });
    expect(v.domain()).toEqual([0, 100]);
    expect(v.range()).toEqual([0, 200]);
  });

  it('un zoom ×2 réduit de moitié le domaine visible (centré sur le range)', () => {
    const base = scaleLinear().domain([0, 100]).range([0, 200]);
    // t choisi pour garder le centre du range (px=100, valeur 50) fixe au zoom ×2 :
    // px' = t + k*px ⇒ pour px=100 fixe : 100 = t + 2*100 ⇒ t = -100.
    const v = rescaleAxis(base, { k: 2, t: -100 });
    expect(v.domain()[0]).toBeCloseTo(25, 5);
    expect(v.domain()[1]).toBeCloseTo(75, 5);
    // le point central (valeur 50) reste au même pixel (100) après zoom.
    expect(v(50)).toBeCloseTo(100, 5);
  });

  it('un pan pur (k=1) décale le domaine sans le redimensionner', () => {
    const base = scaleLinear().domain([0, 100]).range([0, 200]);
    // t=-50 ⇒ tout le contenu se décale de -50px, donc le domaine visible se décale de +25.
    const v = rescaleAxis(base, { k: 1, t: -50 });
    expect(v.domain()[1] - v.domain()[0]).toBeCloseTo(100, 5); // largeur inchangée
    expect(v.domain()[0]).toBeCloseTo(25, 5);
  });

  it('échelle log : le domaine reste toujours strictement positif via minPositive', () => {
    const base = scaleLog().domain([1, 100]).range([0, 200]);
    // Un pan/zoom extrême qui pousserait le domaine sous 0 doit être clampé.
    const v = rescaleAxis(base, { k: 0.1, t: 500 }, 1);
    expect(v.domain()[0]).toBeGreaterThanOrEqual(1);
    expect(v.domain()[1]).toBeGreaterThan(v.domain()[0]);
  });
});
