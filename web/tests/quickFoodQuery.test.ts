import { describe, expect, it } from 'vitest';
import { parseQuickFoodQuery, quickQuantity } from '../src/nutrition/quickFoodQuery';
import { FOOD_BY_ID } from '../src/nutrition/foods';

describe('quick food query', () => {
  it.each(['riz 150g', 'riz 150 g', 'riz 150 gramme', 'riz 150 grammes', '150g riz', '150 g de riz'])('reads explicit gram quantities: %s', (text) => {
    expect(parseQuickFoodQuery(text)).toEqual({ foodQuery: 'riz', quantity: 150, unit: 'g' });
  });
  it.each([
    ['banane 2 pièces', 'banane', 2, 'piece'], ['2 bananes', 'bananes', 2, undefined],
    ['banane 1,5', 'banane', 1.5, undefined], ['riz 0.15 kg', 'riz', 150, 'g'],
    ['lait 25cl', 'lait', 250, 'ml'], ['vitamine D 25 µg', 'vitamine D', 25, 'µg'],
    ['vitamine B12 25ug', 'vitamine B12', 25, 'µg'], ['huile 2 c. à soupe', 'huile', 2, 'cas'],
  ])('accepts decimals and known units: %s', (text, foodQuery, quantity, unit) => {
    expect(parseQuickFoodQuery(String(text))).toEqual({ foodQuery, quantity, ...(unit ? { unit } : {}) });
  });
  it.each(['banane 150h', 'banane 150H', '150h banane', 'banane 0 g'])('keeps search usable without applying an uncertain dose: %s', (text) => {
    expect(parseQuickFoodQuery(text)).toEqual({ foodQuery: 'banane', uncertain: true });
  });
  it.each(['vitamine B12', 'yaourt 0%', 'chocolat 70%', 'riz -150 g', 'banane 2 et riz 150g', 'banane 2 150g'])('does not reinterpret names or complex input: %s', (text) => {
    expect(parseQuickFoodQuery(text)).toEqual({ foodQuery: text });
  });
  it('uses the habitual unit for a bare number, with a cautious fallback', () => {
    const banana = FOOD_BY_ID.get('banane')!;
    const rice = FOOD_BY_ID.get('riz-cuit') ?? { ...banana, pieceGrams: undefined };
    expect(quickQuantity(parseQuickFoodQuery('banane 2'), banana, null)).toEqual({ quantite: 2, unite: 'piece' });
    expect(quickQuantity(parseQuickFoodQuery('banane 150'), banana, { quantite: 120, unite: 'g' })).toEqual({ quantite: 150, unite: 'g' });
    expect(quickQuantity(parseQuickFoodQuery('banane 150'), banana, null)).toBeNull();
    expect(quickQuantity(parseQuickFoodQuery('riz 150'), rice, null)).toBeNull();
    expect(quickQuantity(parseQuickFoodQuery('banane 150g'), banana, { quantite: 2, unite: 'piece' })).toEqual({ quantite: 150, unite: 'g' });
    expect(quickQuantity(parseQuickFoodQuery('banane 150h'), banana, null)).toBeNull();
  });
});
