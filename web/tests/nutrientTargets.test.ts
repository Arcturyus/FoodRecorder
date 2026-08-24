import { describe, expect, it } from 'vitest';
import { computeTargets, countTargetOverrides, DEFAULT_PROFILE, PER_KG_KEYS } from '../src/nutrition/targets';
import type { TargetOverrides } from '../src/nutrition/targets';
import { urgencyScore } from '../src/ui/Totals';
import { niceStep } from '../src/ui/Nutrients';

const BODY = { tailleCm: 178, age: 32 };
const PROFILE = { ...DEFAULT_PROFILE, poids: 70 };

/** Cible d'un nutriment donné, calculée avec les réglages fournis. */
function target(key: string, overrides: TargetOverrides = {}) {
  return computeTargets(PROFILE, BODY, overrides).find((t) => t.key === key)!;
}

describe('cibles réglées à la main', () => {
  it('remplace la valeur calculée, et seulement celle qui est réglée', () => {
    const def = target('magnesium');
    const t = target('magnesium', { magnesium: { optimal: 500 } });
    expect(t.optimal).toBe(500);
    expect(t.ajr).toBe(def.ajr); // l'AJR non touché suit toujours la référence
  });

  it('exprime une cible par kilo de poids de corps', () => {
    const t = target('proteines', { proteines: { optimal: 2, perKg: true } });
    expect(t.optimal).toBe(140); // 2 g/kg × 70 kg
  });

  it('suit le poids : la même cible en g/kg change avec le corps', () => {
    const o: TargetOverrides = { proteines: { optimal: 2, perKg: true } };
    const leger = computeTargets({ ...PROFILE, poids: 60 }, BODY, o).find((t) => t.key === 'proteines')!;
    expect(leger.optimal).toBe(120);
  });

  it('ignore une valeur impossible plutôt que d’afficher une cible absurde', () => {
    const def = target('vitC');
    expect(target('vitC', { vitC: { optimal: Number.NaN } }).optimal).toBe(def.optimal);
    expect(target('vitC', { vitC: { optimal: -5 } }).optimal).toBe(def.optimal);
  });

  it('accepte zéro : c’est la cible réelle de l’alcool et des AG trans', () => {
    expect(target('alcool', { alcool: { optimal: 0 } }).optimal).toBe(0);
  });

  it('garde un optimal au-dessus de son AJR sur les petites valeurs', () => {
    // La vitamine B1 (AJR 1,1 mg × 1,2) tombait à 1 mg avec un arrondi entier :
    // un « optimal » sous l'AJR qu'il est censé dépasser.
    const b1 = target('vitB1');
    expect(b1.optimal).toBeGreaterThan(b1.ajr);
  });

  it('règle aussi un plafond (nutriment à limiter)', () => {
    const t = target('sodium', { sodium: { ajr: 2300, optimal: 1500 } });
    expect(t.goal).toBe('limit');
    expect(t.ajr).toBe(2300);
    expect(t.optimal).toBe(1500);
  });

  it('ne compte que les nutriments portant une vraie valeur', () => {
    expect(countTargetOverrides({})).toBe(0);
    expect(countTargetOverrides({ fer: { perKg: true } })).toBe(0);
    expect(countTargetOverrides({ fer: { ajr: 12 }, zinc: { optimal: 15 } })).toBe(2);
  });

  it('ne propose le « par kg » que là où il a un sens physiologique', () => {
    expect(PER_KG_KEYS.has('proteines')).toBe(true);
    expect(PER_KG_KEYS.has('vitB12')).toBe(false);
  });
});

describe('tri par urgence du bilan du jour', () => {
  const magnesium = target('magnesium'); // à couvrir
  const sodium = target('sodium'); // à limiter

  it('place un manque avant un nutriment couvert', () => {
    expect(urgencyScore(magnesium, 0)).toBeLessThan(urgencyScore(magnesium, magnesium.optimal));
  });

  it('fait passer un plafond dépassé avant tous les manques', () => {
    const depasse = urgencyScore(sodium, sodium.ajr * 1.5);
    expect(depasse).toBeLessThan(urgencyScore(magnesium, 0));
  });

  it('renvoie une limite respectée en fin de grille', () => {
    expect(urgencyScore(sodium, 0)).toBeGreaterThan(urgencyScore(magnesium, magnesium.optimal * 2));
  });
});

describe('pas du curseur de cible', () => {
  it('donne des paliers ronds quelle que soit l’échelle', () => {
    expect(niceStep(900)).toBe(5); // magnésium : 0 → 900 mg, par 5 mg
    expect(niceStep(100)).toBe(1);
    expect(niceStep(30)).toBe(0.2); // vitamine D : 0 → 30 µg
    expect(niceStep(3.2)).toBe(0.02); // protéines : 0 → 3,2 g/kg
  });

  it('ne renvoie jamais un pas nul (échelle absente ou absurde)', () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(Number.NaN)).toBe(1);
  });
});
