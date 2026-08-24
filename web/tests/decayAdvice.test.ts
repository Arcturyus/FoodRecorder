import { describe, expect, it } from 'vitest';
import {
  decayWeight,
  decayWindowDays,
  decayWeightedTotals,
  dayAdvice,
  macroAdvice,
  lowestCoverage,
  DECAY_HALF_LIFE_DEFAULT,
} from '../src/nutrition/recommend';
import type { WeightedDay } from '../src/nutrition/recommend';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { Nutrients } from '../src/nutrition/types';
import type { Target } from '../src/nutrition/targets';
import { decayAverage, movingAverage } from '../src/ui/Stats';

/**
 * Conseils « ces derniers jours » : moyenne pondérée par décroissance
 * exponentielle (le récent pèse plus), branchée sur le MÊME moteur que les
 * conseils du jour. Ce qui doit tenir : la moyenne est homogène à UNE journée
 * (donc comparable aux cibles journalières), et la portée « recents » ne se
 * juge pas au rythme d'une journée en cours.
 */

function day(date: string, weight: number, n: Partial<Nutrients>): WeightedDay {
  return { date, weight, totals: { ...EMPTY_NUTRIENTS, ...n } };
}

const target = (t: Partial<Target> & Pick<Target, 'key' | 'goal'>): Target =>
  ({ label: t.key, unit: 'g', ajr: 0, optimal: 0, ...t }) as Target;

describe('pondération par décroissance', () => {
  it('un jour vieux d’une demi-vie pèse moitié moins', () => {
    expect(decayWeight(0, 3)).toBe(1);
    expect(decayWeight(3, 3)).toBeCloseTo(0.5, 10);
    expect(decayWeight(6, 3)).toBeCloseTo(0.25, 10);
  });

  it('la fenêtre est déduite de la demi-vie (dernier jour à ~10 % du poids)', () => {
    // Demi-vie 3 j → 10 jours : au-delà, un jour pèserait moins de 10 % du plus récent.
    expect(decayWindowDays(DECAY_HALF_LIFE_DEFAULT)).toBe(10);
    expect(decayWeight(decayWindowDays(3), 3)).toBeLessThanOrEqual(0.1);
    expect(decayWeight(decayWindowDays(3) - 1, 3)).toBeGreaterThan(0.1);
    // La fenêtre suit le réglage : demi-vie plus courte ⇒ mémoire plus courte.
    expect(decayWindowDays(1)).toBeLessThan(decayWindowDays(7));
  });

  it('la moyenne pondérée reste homogène à UNE journée', () => {
    // Deux jours identiques à 2000 kcal : la moyenne vaut 2000, pas 4000.
    const days = [day('2026-08-04', 0.5, { kcal: 2000 }), day('2026-08-05', 1, { kcal: 2000 })];
    expect(decayWeightedTotals(days).kcal).toBeCloseTo(2000, 6);
  });

  it('le jour récent tire la moyenne plus fort que l’ancien', () => {
    const days = [day('2026-07-27', decayWeight(9, 3), { proteines: 0 }), day('2026-08-05', 1, { proteines: 100 })];
    const avg = decayWeightedTotals(days).proteines;
    expect(avg).toBeGreaterThan(50); // une moyenne simple donnerait 50
    expect(avg).toBeLessThan(100);
  });

  it('une fenêtre vide ne casse rien (que des zéros)', () => {
    expect(decayWeightedTotals([]).kcal).toBe(0);
  });
});

describe('classement « les plus bas en ce moment »', () => {
  const targets = [
    target({ key: 'kcal', goal: 'atLeast', unit: 'kcal', optimal: 2000 }),
    target({ key: 'vitB9', goal: 'atLeast', unit: 'µg', optimal: 400 }),
    target({ key: 'vitC', goal: 'atLeast', unit: 'mg', optimal: 100 }),
    target({ key: 'creatine', goal: 'atLeast', unit: 'g', optimal: 3 }),
    target({ key: 'sodium', goal: 'limit', unit: 'mg', ajr: 2300, optimal: 1500 }),
    target({ key: 'fibres', goal: 'atLeast', unit: 'g', optimal: 30 }),
  ];

  it('classe du plus bas au moins bas et rend la couverture', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 2000, vitB9: 40, vitC: 80 };
    const lows = lowestCoverage(totals, targets, [], () => 1, 'recents');
    expect(lows[0].target.key).toBe('vitB9');
    expect(lows[0].coverage).toBeCloseTo(0.1, 6);
  });

  it('écarte la créatine, les calories, les macros secondaires et les plafonds', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 100, vitB9: 200, creatine: 0, fibres: 0, sodium: 0 };
    const keys = lowestCoverage(totals, targets, [], () => 1, 'recents').map((l) => l.target.key);
    expect(keys).not.toContain('creatine'); // s'obtient par complément, trusterait le classement
    expect(keys).not.toContain('kcal');
    expect(keys).not.toContain('fibres'); // couvert par la section macros
    expect(keys).not.toContain('sodium'); // c'est un plafond, pas un manque
  });

  it('un nutriment mis en sourdine (importance 0) sort du classement', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 2000, vitB9: 0, vitC: 50 };
    const muted = (k: string) => (k === 'vitB9' ? 0 : 1);
    const keys = lowestCoverage(totals, targets, [], muted as never, 'recents').map((l) => l.target.key);
    expect(keys).toEqual(['vitC']);
  });

  it('l’importance départage le classement par rang, hors garantie brute', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 2000, vitB9: 200, vitC: 10 };
    // vitC manque bien plus, mais si B9 est jugé 5× plus important il passe devant
    // — la garantie brute (testée séparément) est désactivée ici pour isoler le tri par rang.
    const imp = (k: string) => (k === 'vitB9' ? 5 : 0.2);
    const keys = lowestCoverage(totals, targets, [], imp as never, 'recents', undefined, 0).map((l) => l.target.key);
    expect(keys[0]).toBe('vitB9');
  });

  it('les nutriments les plus manquants en brut sont toujours en tête, même peu importants', () => {
    const manyTargets = [
      ...targets,
      target({ key: 'vitD', goal: 'atLeast', unit: 'µg', optimal: 10 }),
      target({ key: 'vitE', goal: 'atLeast', unit: 'mg', optimal: 10 }),
    ];
    // vitB9 est très important mais presque couvert (90 %) ; vitC/vitD/vitE manquent
    // bien plus mais sont jugés sans importance — ils doivent quand même apparaître en tête.
    const totals = { ...EMPTY_NUTRIENTS, kcal: 2000, vitB9: 360, vitC: 5, vitD: 1, vitE: 1 };
    const imp = (k: string) => (k === 'vitB9' ? 10 : 0.1);
    const keys = lowestCoverage(totals, manyTargets, [], imp as never, 'recents').map((l) => l.target.key);
    expect(keys.slice(0, 3).sort()).toEqual(['vitC', 'vitD', 'vitE']);
    expect(keys).toContain('vitB9');
  });

  it('en portée « jour », la couverture est rapportée à l’avancement calorique', () => {
    // Mi-journée (50 % des kcal) avec 150 µg sur 400 : 37 % de la cible, mais
    // 75 % du rythme attendu — c'est ce dernier chiffre qui doit être rendu.
    const totals = { ...EMPTY_NUTRIENTS, kcal: 1000, vitB9: 150, vitC: 100 };
    const [low] = lowestCoverage(totals, targets, [], () => 1, 'jour');
    expect(low.target.key).toBe('vitB9');
    expect(low.coverage).toBeCloseTo(0.75, 6);
  });

  it('un nutriment pile dans les temps n’est pas listé comme « bas »', () => {
    // 50 % de la B9 à 50 % de la journée : couverture 1 au rythme du jour.
    const totals = { ...EMPTY_NUTRIENTS, kcal: 1000, vitB9: 200, vitC: 100 };
    const keys = lowestCoverage(totals, targets, [], () => 1, 'jour').map((l) => l.target.key);
    expect(keys).not.toContain('vitB9');
  });

  it('ne liste pas les nutriments déjà couverts', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 2000, vitB9: 400, vitC: 100, collagene: 999 };
    expect(lowestCoverage(totals, targets, [], () => 1, 'recents')).toEqual([]);
  });
});

describe('lissage dégressif des courbes (Stats)', () => {
  it('chaque point regarde le passé, jamais l’avenir', () => {
    // Un pic au dernier point ne doit pas remonter les points précédents.
    const out = decayAverage([0, 0, 100], 3) as number[];
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBeGreaterThan(0);
  });

  it('le point courant pèse plus que ses antécédents', () => {
    // Moyenne mobile plate : 50. Pondérée : plus proche du 100 le plus récent.
    const plate = movingAverage([0, 100], 2) as number[];
    const pondere = decayAverage([0, 100], 3) as number[];
    expect(plate[1]).toBeCloseTo(50, 6);
    expect(pondere[1]).toBeGreaterThan(plate[1]);
  });

  it('une demi-vie courte colle à la valeur du jour, une longue lisse plus', () => {
    const values = [0, 0, 0, 100];
    const court = (decayAverage(values, 1) as number[])[3];
    const long = (decayAverage(values, 14) as number[])[3];
    expect(court).toBeGreaterThan(long);
    expect(court).toBeLessThanOrEqual(100);
  });

  it('ignore les trous au lieu de les compter comme des zéros', () => {
    const out = decayAverage([80, null, 80], 3) as number[];
    expect(out[2]).toBeCloseTo(80, 6);
    expect(decayAverage([null, null], 3)).toEqual([null, null]);
    // Même règle pour la moyenne mobile simple : la fenêtre ne compte que les jours remplis.
    expect(movingAverage([2, null, 4], 3)).toEqual([2, 2, 3]);
  });

  it('un plateau constant reste à sa valeur (pas de biais)', () => {
    const out = decayAverage([42, 42, 42, 42], 3) as number[];
    for (const v of out) expect(v).toBeCloseTo(42, 6);
  });
});

describe('portée des conseils', () => {
  const targets = [
    target({ key: 'kcal', goal: 'atLeast', unit: 'kcal', optimal: 2000 }),
    target({ key: 'vitB9', goal: 'atLeast', unit: 'µg', optimal: 400 }),
  ];

  it('« jour » masque tout tant que la journée est trop peu avancée', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 400, vitB9: 0 }; // 20 % des kcal
    expect(dayAdvice(totals, targets, [], new Set(), () => 1, 'jour')).toEqual([]);
  });

  it('« recents » ne se juge pas au rythme d’une journée en cours', () => {
    // Mêmes chiffres : en moyenne sur des journées TERMINÉES, une couverture de
    // 20 % des calories et 0 de B9 est une vraie alerte, pas un petit-déjeuner.
    const totals = { ...EMPTY_NUTRIENTS, kcal: 400, vitB9: 0 };
    const items = dayAdvice(totals, targets, [], new Set(), () => 1, 'recents');
    expect(items.some((it) => it.target?.key === 'vitB9')).toBe(true);
  });

  it('les textes ne parlent pas du « soir » sur une moyenne de jours passés', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 2000, vitB9: 50 };
    const [jour] = dayAdvice(totals, targets, [], new Set(), () => 1, 'jour');
    const [recents] = dayAdvice(totals, targets, [], new Set(), () => 1, 'recents');
    expect(jour.text).toContain('ce soir');
    expect(recents.text).not.toContain('ce soir');
    expect(recents.text).toContain('par jour');
  });

  it('un plafond dépassé se formule au présent le jour même, au passé en moyenne', () => {
    const limits = [
      target({ key: 'kcal', goal: 'atLeast', unit: 'kcal', optimal: 2000 }),
      target({ key: 'sodium', goal: 'limit', unit: 'mg', ajr: 2300, optimal: 1500 }),
    ];
    const totals = { ...EMPTY_NUTRIENTS, kcal: 2000, sodium: 4000 };
    const [jour] = dayAdvice(totals, limits, [], new Set(), () => 1, 'jour');
    const [recents] = dayAdvice(totals, limits, [], new Set(), () => 1, 'recents');
    expect(jour.kind).toBe('excess');
    expect(recents.kind).toBe('excess');
    expect(jour.text).toContain('déjà atteint');
    expect(recents.text).toContain('en moyenne');
  });

  it('les macros aussi changent de formulation, pas de calcul', () => {
    const macroTargets = [
      target({ key: 'kcal', goal: 'atLeast', unit: 'kcal', optimal: 2000 }),
      target({ key: 'proteines', goal: 'atLeast', unit: 'g', optimal: 120 }),
    ];
    const totals = { ...EMPTY_NUTRIENTS, kcal: 1500, proteines: 60 };
    const jour = macroAdvice(totals, macroTargets, [], new Set(), () => 1, 'jour');
    const recents = macroAdvice(totals, macroTargets, [], new Set(), () => 1, 'recents');
    expect(jour?.kcalLeft).toBe(recents?.kcalLeft);
    expect(jour?.protLeft).toBe(recents?.protLeft);
    expect(recents?.text).toContain('moyenne');
  });
});
