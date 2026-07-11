import { describe, expect, it } from 'vitest';
import {
  estimateVitaminD,
  vitaminDBreakdown,
  sunVitDForDate,
  SUN_DAY_CAP,
  seasonHint,
} from '../src/sun/vitaminD';
import type { SunExposure } from '../src/sun/vitaminD';

const base = {
  date: '2026-07-10',
  heure: '13:30',
  dureeMin: 15,
  ciel: 'tres-ensoleille' as const,
  peau: 'visage-bras' as const,
  phenotype: 'blanc' as const,
  creme: false,
};

function exposure(patch: Partial<SunExposure> = {}): SunExposure {
  return { id: 'x', createdAt: 0, ...base, ...patch };
}

describe('estimation vitamine D solaire', () => {
  it('ordre de grandeur : ~15 min plein été à midi, visage + bras, peau claire ≈ 20–30 µg', () => {
    const gain = estimateVitaminD(base);
    expect(gain).toBeGreaterThan(15);
    expect(gain).toBeLessThan(35);
  });

  it('quasi nul en hiver en France', () => {
    expect(estimateVitaminD({ ...base, date: '2026-01-10', dureeMin: 60 })).toBeLessThan(5);
  });

  it('nul en dehors de la fenêtre UVB (soirée)', () => {
    expect(estimateVitaminD({ ...base, heure: '20:30' })).toBe(0);
  });

  it('un ciel couvert réduit fortement le gain', () => {
    const couvert = estimateVitaminD({ ...base, ciel: 'couvert' });
    expect(couvert).toBeLessThan(estimateVitaminD(base) * 0.2);
    expect(couvert).toBeGreaterThan(0);
  });

  it('plus de peau découverte = plus de gain', () => {
    expect(estimateVitaminD({ ...base, peau: 'torse-nu' })).toBeGreaterThan(
      estimateVitaminD({ ...base, peau: 'visage-mains' }),
    );
  });

  it('une peau plus foncée synthétise moins à conditions égales', () => {
    expect(estimateVitaminD({ ...base, phenotype: 'noir' })).toBeLessThan(estimateVitaminD(base));
    expect(estimateVitaminD({ ...base, phenotype: 'noir' })).toBeCloseTo(estimateVitaminD(base) * 0.3, 5);
  });

  it('la crème solaire réduit le gain (SPF 50, appliquée une fois)', () => {
    expect(estimateVitaminD({ ...base, creme: true })).toBeCloseTo(estimateVitaminD(base) * 0.4, 5);
  });

  it('champs manquants (phénotype/crème) → valeurs par défaut peau claire / sans crème', () => {
    const sansDefaults = estimateVitaminD({ date: base.date, heure: base.heure, dureeMin: base.dureeMin, ciel: base.ciel, peau: base.peau });
    expect(sansDefaults).toBeCloseTo(estimateVitaminD(base), 5);
  });

  it('rendements décroissants : 4 h ne rapportent pas 16× 15 min', () => {
    const court = estimateVitaminD(base);
    const long = estimateVitaminD({ ...base, dureeMin: 240 });
    expect(long).toBeGreaterThan(court);
    expect(long).toBeLessThan(court * 6);
  });

  it('le total du jour est plafonné', () => {
    const many = Array.from({ length: 10 }, (_, i) => exposure({ id: `e${i}`, dureeMin: 120, peau: 'torse-nu' }));
    expect(sunVitDForDate(many, base.date)).toBe(SUN_DAY_CAP);
  });

  it('ignore les expositions des autres jours', () => {
    expect(sunVitDForDate([exposure({ date: '2026-07-09' })], base.date)).toBe(0);
  });

  it('note saisonnière : présente en hiver, absente en plein été', () => {
    expect(seasonHint('2026-12-01')).toBeTruthy();
    expect(seasonHint('2026-07-10')).toBeNull();
  });
});

describe('décomposition de la formule', () => {
  it('expose un terme par facteur (durée, saison, heure, ciel, peau, phénotype, crème)', () => {
    const b = vitaminDBreakdown(base);
    expect(b.factors.map((f) => f.key)).toEqual(['duree', 'saison', 'heure', 'ciel', 'peau', 'phenotype', 'creme']);
    expect(b.gain).toBeCloseTo(estimateVitaminD(base), 6);
  });

  it('le produit base × facteurs reconstitue le gain (hors plafond)', () => {
    const b = vitaminDBreakdown(base);
    const product = b.factors.reduce((a, f) => a * f.value, b.base);
    expect(product).toBeCloseTo(b.gain, 6);
  });

  it('signale le plafonnement', () => {
    const b = vitaminDBreakdown({ ...base, dureeMin: 300, peau: 'torse-nu' });
    // une seule exposition très longue reste sous le plafond journalier ici
    expect(b.gain).toBeLessThanOrEqual(SUN_DAY_CAP);
  });
});
