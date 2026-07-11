import { describe, expect, it } from 'vitest';
import { toGrams, scaleNutrients, computeItems, totalNutrients } from '../src/nutrition/compute';
import { FOODS, FOOD_BY_ID } from '../src/nutrition/foods';

describe('conversions et calculs', () => {
  it('convertit les pièces via le poids moyen de l\'aliment', () => {
    const banane = FOOD_BY_ID.get('banane')!;
    // 1 banane ≈ 120 g
    expect(toGrams({ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }, banane)).toBe(120);
    expect(toGrams({ aliment: 'banane', quantite: 2, unite: 'piece', estimation: false }, banane)).toBe(240);
  });

  it('le poids en grammes donné par l\'utilisateur prime toujours', () => {
    const mangue = FOOD_BY_ID.get('mangue')!;
    expect(toGrams({ aliment: 'mangue', quantite: 200, unite: 'g', estimation: false }, mangue)).toBe(200);
  });

  it('utilise les surcharges d\'unité (tranche de pain, pot de yaourt)', () => {
    const pain = FOOD_BY_ID.get('baguette')!;
    expect(toGrams({ aliment: 'pain', quantite: 1, unite: 'tranche', estimation: false }, pain)).toBe(30);
  });

  it('met à l\'échelle les nutriments pour 100 g', () => {
    const poulet = FOOD_BY_ID.get('filet-poulet')!;
    const n = scaleNutrients(poulet.n, 200);
    expect(n.kcal).toBeCloseTo(poulet.n.kcal * 2, 5);
    expect(n.proteines).toBeCloseTo(poulet.n.proteines * 2, 5);
  });

  it('additionne les totaux d\'un repas', () => {
    const computed = computeItems([
      { aliment: 'banane', quantite: 1, unite: 'piece', estimation: false },
      { aliment: 'oeuf', quantite: 2, unite: 'piece', estimation: false },
    ], FOODS);
    const totals = totalNutrients(computed);
    const banane = scaleNutrients(FOOD_BY_ID.get('banane')!.n, 120);
    const oeufs = scaleNutrients(FOOD_BY_ID.get('oeuf')!.n, 110);
    expect(totals.kcal).toBeCloseTo(banane.kcal + oeufs.kcal, 4);
  });

  it('inclut les micros ajoutés manuellement (créatine, K2, iode, sélénium)', () => {
    const computed = computeItems([{ aliment: 'saumon', quantite: 100, unite: 'g', estimation: false }], FOODS);
    const t = totalNutrients(computed);
    expect(t.creatine).toBeGreaterThan(0);
    expect(t.selenium).toBeGreaterThan(0);
    expect(t.iode).toBeGreaterThan(0);
    expect(t.vitD).toBeGreaterThan(0);
    const oeuf = computeItems([{ aliment: 'oeuf', quantite: 100, unite: 'g', estimation: false }], FOODS);
    expect(totalNutrients(oeuf).vitK2).toBeGreaterThan(0);
  });
});
