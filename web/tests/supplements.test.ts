import { describe, expect, it } from 'vitest';
import { toGrams, scaleNutrients, computeItems, totalNutrients } from '../src/nutrition/compute';
import { FOODS, FOOD_BY_ID } from '../src/nutrition/foods';
import { parseTranscript } from '../src/extraction/ruleParser';

describe('unités mg / µg et compléments élément pur', () => {
  it('convertit mg et µg en grammes (masse littérale)', () => {
    expect(toGrams({ aliment: 'x', quantite: 300, unite: 'mg', estimation: false }, null)).toBeCloseTo(0.3, 9);
    expect(toGrams({ aliment: 'x', quantite: 25, unite: 'µg', estimation: false }, null)).toBeCloseTo(0.000025, 12);
  });

  it('300 mg de magnésium (complément) apportent 300 mg de magnésium élément', () => {
    const mag = FOOD_BY_ID.get('supp-magnesium')!;
    const grams = toGrams({ aliment: 'magnésium', quantite: 300, unite: 'mg', estimation: false }, mag);
    expect(scaleNutrients(mag.n, grams).magnesium).toBeCloseTo(300, 6);
  });

  it('25 µg de vitamine D3 (complément) apportent 25 µg de vitamine D', () => {
    const vd = FOOD_BY_ID.get('supp-vitd')!;
    const grams = toGrams({ aliment: 'vitamine d', quantite: 25, unite: 'µg', estimation: false }, vd);
    expect(scaleNutrients(vd.n, grams).vitD).toBeCloseTo(25, 6);
  });

  it('500 mg de vitamine C élément', () => {
    const vc = FOOD_BY_ID.get('supp-vitc')!;
    const grams = toGrams({ aliment: 'vitamine c', quantite: 500, unite: 'mg', estimation: false }, vc);
    expect(scaleNutrients(vc.n, grams).vitC).toBeCloseTo(500, 6);
  });

  it('le parseur reconnaît « 300 mg de magnésium » et « 25 microgrammes de vitamine D »', () => {
    const a = parseTranscript('300 mg de magnésium');
    expect(a[0]).toMatchObject({ quantite: 300, unite: 'mg' });
    const b = parseTranscript('25 microgrammes de vitamine D');
    expect(b[0]).toMatchObject({ quantite: 25, unite: 'µg' });
  });

  it('dictée complète : « 300 mg de magnésium » → 300 mg dans le bilan', () => {
    const items = parseTranscript('300 mg de magnésium');
    const t = totalNutrients(computeItems(items, FOODS));
    expect(t.magnesium).toBeCloseTo(300, 4);
  });

  it('le vinaigre est présent dans la banque', () => {
    expect(FOODS.some((f) => f.id === 'vinaigre')).toBe(true);
    expect(FOODS.some((f) => f.id === 'vinaigre-balsamique')).toBe(true);
  });
});
