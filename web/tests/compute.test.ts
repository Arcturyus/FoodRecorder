import { describe, expect, it } from 'vitest';
import { toGrams, scaleNutrients, computeItems, totalNutrients } from '../src/nutrition/compute';
import { FOODS, FOOD_BY_ID } from '../src/nutrition/foods';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import { validateExtraction } from '../src/extraction/schema';

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

describe('estimation IA d\'un aliment hors base', () => {
  it('utilise les nutriments estimés quand l\'aliment est absent de la base', () => {
    const [ci] = computeItems([
      {
        aliment: 'pastel de nata',
        quantite: 1,
        unite: 'piece',
        estimation: true,
        categorie: 'sucre-snack',
        grammesParPiece: 60,
        nutriments: { ...EMPTY_NUTRIENTS, kcal: 298, proteines: 6, glucides: 37, lipides: 13 },
      },
    ], FOODS);
    expect(ci.aiEstime).toBe(true);
    expect(ci.match.food).toBeNull();
    expect(ci.grams).toBe(60); // grammesParPiece pris en compte
    expect(ci.nutrients?.kcal).toBeCloseTo(298 * 0.6, 4);
    expect(ci.nutrients?.proteines).toBeCloseTo(6 * 0.6, 4);
  });

  it('préfère la base à l\'estimation IA quand l\'aliment y est trouvé', () => {
    const [ci] = computeItems([
      {
        aliment: 'banane',
        quantite: 100,
        unite: 'g',
        estimation: false,
        nutriments: { ...EMPTY_NUTRIENTS, kcal: 9999 },
      },
    ], FOODS);
    expect(ci.aiEstime).toBeFalsy();
    expect(ci.match.food?.id).toBe('banane');
    expect(ci.nutrients?.kcal).not.toBeCloseTo(9999, 0);
  });

  it('conserve l\'estimation IA d\'un plat malgré un recoupement partiel avec la base', () => {
    // Cas réel : « une part de gâteau au chocolat noir » (avec ses ingrédients) était
    // écrasée par l'aliment « Chocolat noir 85% » de la base (alias « chocolat noir »,
    // portion 20 g) au lieu de garder l'estimation du plat (portion ~90 g).
    const [ci] = computeItems([
      {
        aliment: 'gâteau au chocolat noir',
        quantite: 1,
        unite: 'portion',
        estimation: true,
        categorie: 'sucre-snack',
        grammesParPiece: 90,
        nutriments: { ...EMPTY_NUTRIENTS, kcal: 390, proteines: 6, glucides: 45, lipides: 21 },
      },
    ], FOODS);
    expect(ci.aiEstime).toBe(true);
    expect(ci.match.food).toBeNull();
    expect(ci.grams).toBe(90); // portion estimée du plat, pas les 20 g du carré de chocolat
    expect(ci.nutrients?.kcal).toBeCloseTo(390 * 0.9, 4);
  });

  it('valideExtraction complète tous les nutriments manquants à 0', () => {
    const items = validateExtraction({
      items: [{ aliment: 'poke bowl', quantite: 1, unite: 'bol', estimation: true, nutriments: { kcal: 150, proteines: 10 } }],
    });
    expect(items).not.toBeNull();
    const n = items![0].nutriments!;
    expect(n.kcal).toBe(150);
    expect(n.proteines).toBe(10);
    expect(n.creatine).toBe(0); // clé absente → 0
    expect(Object.keys(n).length).toBe(Object.keys(EMPTY_NUTRIENTS).length);
  });
});
