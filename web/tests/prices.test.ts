import { describe, expect, it } from 'vitest';
import { FOOD_BY_ID, FOODS } from '../src/nutrition/foods';
import { PRICE_SEED } from '../src/nutrition/priceSeedData';
import { enrichBankPrices, seedPriceFor } from '../src/nutrition/priceSeed';
import { costOfItems, meanCompleteCosts } from '../src/nutrition/price';
import { cheaperAlternatives } from '../src/nutrition/cheaperAlternatives';
import { foodFromEstimate } from '../src/nutrition/bank';
import { paretoFrontier, pearson } from '../src/ui/FoodExplorer';
import { useStore } from '../src/store/store';
import { buildBackup, importBackup } from '../src/store/backup';
import type { Food } from '../src/nutrition/types';
import type { JournalItem } from '../src/store/store';

const pomme = FOOD_BY_ID.get('pomme')!;
const banane = FOOD_BY_ID.get('banane')!;
const withPrice = (food: Food, id: string, amount: number): Food => ({ ...food, id, price: { eurPerKg: amount, confidence: 'moyenne', date: '2026-09-29', origin: 'manuel' } });
const item = (food: Food, grams: number): JournalItem => ({ id: food.id, foodId: food.id, nomAffiche: food.nom, quantite: grams, unite: 'g', grams, nutrients: food.n, estimation: false, douteux: false });

describe('prix des aliments', () => {
  it('charge les deux sections du relevé et les références du catalogue', () => {
    expect(PRICE_SEED.filter((row) => row.scope === 'bank')).toHaveLength(206);
    expect(PRICE_SEED.filter((row) => row.scope === 'catalogue')).toHaveLength(72);
    const names = new Set(FOODS.map((food) => food.nom.toLocaleLowerCase('fr')));
    expect(PRICE_SEED.filter((row) => row.scope === 'catalogue' && !names.has(row.name.toLocaleLowerCase('fr')))).toEqual([]);
    expect(FOODS.filter((food) => !food.price).map((food) => food.nom)).toEqual([]);
    expect(pomme.price?.eurPerKg).toBeGreaterThan(0);
  });

  it('préserve un prix corrigé ou explicitement laissé inconnu', () => {
    const legacy = { ...pomme, price: undefined };
    const corrected = withPrice(pomme, 'corrected', 12);
    const unknown = { ...pomme, id: 'unknown', price: null };
    const result = enrichBankPrices([legacy, corrected, unknown]);
    expect(result[0].price).toEqual(seedPriceFor(legacy, 'bank'));
    expect(result[1].price).toEqual(corrected.price);
    expect(result[2].price).toBeNull();
  });

  it('garde une création IA si le prix manque, et date le prix présent', () => {
    const absent = foodFromEstimate('Nouvel aliment', { kcal: 123 });
    const present = foodFromEstimate('Autre aliment', { kcal: 123 }, { prixEurKg: 7, confiancePrix: 'faible', ajouteLe: '2026-09-29' });
    expect(absent.price).toBeUndefined();
    expect(absent.aVerifier).toBe(true);
    expect(present.price).toMatchObject({ eurPerKg: 7, confidence: 'faible', date: '2026-09-29', origin: 'ia' });
  });

  it('conserve le prix dans une sauvegarde sans valider les nutriments sur une correction du prix seule', () => {
    const food = { ...foodFromEstimate('Essai prix', { kcal: 123 }), price: null };
    useStore.setState({ customFoods: [food], entries: [] });
    const corrected = withPrice(food, food.id, 9);
    useStore.getState().editFood(food.id, { price: corrected.price });
    expect(useStore.getState().customFoods[0].aVerifier).toBe(true);
    const json = JSON.stringify(buildBackup());
    useStore.setState({ customFoods: [] });
    importBackup(json);
    expect(useStore.getState().customFoods[0].price).toEqual(corrected.price);
  });

  it('calcule un coût partiel à partir des quantités et des prix actuels', () => {
    const known = withPrice(pomme, 'known', 4);
    const missing = { ...banane, id: 'missing', price: null };
    const result = costOfItems([item(known, 250), item(missing, 100)], [known, missing]);
    expect(result.knownEur).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.missingNames).toEqual([missing.nom]);
    expect(costOfItems([item(withPrice(known, 'known', 8), 250)], [withPrice(known, 'known', 8)]).knownEur).toBe(2);
  });

  it('exclut les jours partiels de la moyenne de période, avec pondération', () => {
    const complete = (knownEur: number) => ({ knownEur, pricedItems: 1, contributions: [], missingNames: [], complete: true });
    const partial = { ...complete(100), complete: false, missingNames: ['Sans prix'] };
    expect(meanCompleteCosts([{ cost: complete(2), weight: 1 }, { cost: partial, weight: 1 }, { cost: complete(4), weight: 3 }])).toBe(3.5);
    expect(meanCompleteCosts([{ cost: partial, weight: 1 }])).toBeNull();
  });

  it('utilise la dominance Pareto ordinaire pour prix et protéines', () => {
    const points = [{ id: 'a', x: 2, y: 10 }, { id: 'b', x: 2, y: 20 }, { id: 'c', x: 4, y: 30 }];
    expect(paretoFrontier(points, 'min', 'max', false).map((point) => point.id)).toEqual(['b', 'c']);
  });

  it('calcule une corrélation sur les paires disponibles seulement', () => {
    expect(pearson([1, Number.NaN, 2, 3], [2, 99, 4, 6])).toEqual({ r: 1, n: 3 });
    expect(pearson([1, 2], [2, 4])).toEqual({ r: null, n: 2 });
    expect(pearson([1, 1, 1], [2, 3, 4])).toEqual({ r: null, n: 3 });
  });

  it('classe les alternatives moins chères par profil nutritionnel, puis élargit la catégorie', () => {
    const source = withPrice(pomme, 'source', 10);
    const similar = withPrice({ ...pomme, nom: 'Similaire' }, 'similar', 8);
    const different = withPrice({ ...pomme, nom: 'Différent', n: { ...pomme.n, proteines: 20 } }, 'different', 5);
    const otherCategory = withPrice({ ...pomme, nom: 'Autre catégorie', categorie: 'legume' }, 'other', 7);
    const expensive = withPrice({ ...pomme, nom: 'Cher' }, 'expensive', 12);
    expect(cheaperAlternatives(source, [source, similar, different, otherCategory, expensive]).map((result) => result.food.id)).toEqual(['similar', 'different']);
    expect(cheaperAlternatives(source, [source, similar, otherCategory], false).map((result) => result.food.id)).toEqual(['other', 'similar']);
  });
});
