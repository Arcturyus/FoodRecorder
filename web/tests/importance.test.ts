import { describe, expect, it } from 'vitest';
import {
  computeGaps,
  dayAdvice,
  makeImportanceFn,
  effectiveImportance,
  DEFAULT_IMPORTANCE,
  RECO_DEFAULTS,
} from '../src/nutrition/recommend';
import { computeTargets, DEFAULT_PROFILE } from '../src/nutrition/targets';
import { FOODS } from '../src/nutrition/foods';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { NutrientKey } from '../src/nutrition/types';

const targets = computeTargets(DEFAULT_PROFILE);
const gapOf = (analysis: ReturnType<typeof computeGaps>, key: NutrientKey) =>
  analysis.gaps.find((g) => g.key === key);

describe('effectiveImportance', () => {
  it('applique les défauts RDA (créatine ↓, oméga 3 ↑) et les overrides', () => {
    expect(DEFAULT_IMPORTANCE.creatine).toBe(0.4);
    expect(effectiveImportance('creatine')).toBe(0.4);
    expect(effectiveImportance('omega3')).toBe(1.5);
    expect(effectiveImportance('vitC')).toBe(1); // pas de défaut ⇒ 1
    expect(effectiveImportance('creatine', { creatine: 2 })).toBe(2); // override prime
  });
});

describe('computeGaps pondéré par importance', () => {
  // Apports tous nuls ⇒ chaque nutriment « à couvrir » est un manque complet (missing = 1).
  const averages = { ...EMPTY_NUTRIENTS };

  it("multiplie le poids d'un manque par l'importance", () => {
    const neutral = computeGaps(averages, targets, RECO_DEFAULTS); // importance = 1 partout
    const boosted = computeGaps(averages, targets, RECO_DEFAULTS, (k) => (k === 'vitC' ? 2 : 1));
    const base = gapOf(neutral, 'vitC')!.weight;
    expect(gapOf(boosted, 'vitC')!.weight).toBeCloseTo(base * 2, 6);
  });

  it('retire du classement un nutriment mis à 0', () => {
    const analysis = computeGaps(averages, targets, RECO_DEFAULTS, (k) => (k === 'vitC' ? 0 : 1));
    expect(gapOf(analysis, 'vitC')).toBeUndefined();
  });

  it('les défauts RDA font peser la créatine moins que la vitamine C', () => {
    const analysis = computeGaps(averages, targets, RECO_DEFAULTS, makeImportanceFn({}));
    expect(gapOf(analysis, 'creatine')!.weight).toBeLessThan(gapOf(analysis, 'vitC')!.weight);
  });

  it('pondère aussi les excès (pénalités) et les retire à 0', () => {
    const salty = { ...EMPTY_NUTRIENTS, sodium: 4000 };
    const penaltyOf = (imp: (k: NutrientKey) => number) =>
      computeGaps(salty, targets, RECO_DEFAULTS, imp).penalties.find((p) => p.key === 'sodium');
    const base = penaltyOf(() => 1)!.weight;
    expect(penaltyOf((k) => (k === 'sodium' ? 2 : 1))!.weight).toBeCloseTo(base * 2, 6);
    expect(penaltyOf((k) => (k === 'sodium' ? 0 : 1))).toBeUndefined();
  });
});

describe('dayAdvice pondéré par importance', () => {
  const kcalOptimal = targets.find((t) => t.key === 'kcal')!.optimal;
  // Journée à mi-parcours calorique, mais pauvre en micros ⇒ nombreux nutriments en retard.
  const totals = { ...EMPTY_NUTRIENTS, kcal: kcalOptimal * 0.6 };

  it('retire un nutriment mis à 0 des conseils du jour', () => {
    const base = dayAdvice(totals, targets, FOODS, new Set(), () => 1);
    // Un nutriment réellement signalé par défaut (déficit sur le rythme du jour).
    const key = base.find((it) => it.kind === 'deficit' && it.target)?.target!.key;
    expect(key).toBeDefined();

    const muted = dayAdvice(totals, targets, FOODS, new Set(), (k) => (k === key ? 0 : 1));
    expect(muted.some((it) => it.target?.key === key)).toBe(false);
  });
});
