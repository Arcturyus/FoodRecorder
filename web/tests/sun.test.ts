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
  creme: 'aucune' as const,
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
    const noir = estimateVitaminD({ ...base, phenotype: 'noir' });
    const blanc = estimateVitaminD(base);
    expect(noir).toBeLessThan(blanc);
    // Sur une sortie courte (régime linéaire), le ratio reste proche du facteur mélanine (0,3).
    expect(noir / blanc).toBeGreaterThan(0.25);
    expect(noir / blanc).toBeLessThan(0.4);
  });

  it('interconnexion phototype × durée : la peau foncée sature plus tard et rattrape une partie de l\'écart', () => {
    const ratioCourt = estimateVitaminD({ ...base, phenotype: 'noir' }) / estimateVitaminD(base);
    const ratioLong =
      estimateVitaminD({ ...base, phenotype: 'noir', dureeMin: 240 }) / estimateVitaminD({ ...base, dureeMin: 240 });
    expect(ratioLong).toBeGreaterThan(ratioCourt);
  });

  it('la crème solaire complète réduit fortement le gain (SPF 50, appliquée une fois)', () => {
    const ratio = estimateVitaminD({ ...base, creme: 'complete' }) / estimateVitaminD(base);
    // ~0,4 (filtre) mais un peu plus : la peau crémée sature aussi plus lentement.
    expect(ratio).toBeGreaterThanOrEqual(0.4);
    expect(ratio).toBeLessThan(0.55);
  });

  it('accepte l\'ancien format booléen (true = crème complète)', () => {
    // @ts-expect-error compat : données persistées avant le passage à l'enum
    expect(estimateVitaminD({ ...base, creme: true })).toBeCloseTo(estimateVitaminD({ ...base, creme: 'complete' }), 6);
  });

  it('la crème sur le visage seulement réduit peu le gain (le reste de la peau synthétise)', () => {
    const sansCreme = estimateVitaminD(base);
    const visage = estimateVitaminD({ ...base, creme: 'visage' });
    expect(visage).toBeLessThan(sansCreme);
    expect(visage).toBeGreaterThan(estimateVitaminD({ ...base, creme: 'complete' }));
    // En t-shirt (peau exposée large), l'effet du visage crémé reste modéré (> 80 %).
    expect(visage).toBeGreaterThan(sansCreme * 0.8);
  });

  it('crème visage : effet plus marqué quand peu de peau est découverte (visage/mains)', () => {
    const ref = { ...base, peau: 'visage-mains' as const };
    const ratioVisageMains = estimateVitaminD({ ...ref, creme: 'visage' }) / estimateVitaminD(ref);
    const ratioTorseNu = estimateVitaminD({ ...base, peau: 'torse-nu', creme: 'visage' }) / estimateVitaminD({ ...base, peau: 'torse-nu' });
    expect(ratioVisageMains).toBeLessThan(ratioTorseNu);
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

  it('interconnexion heure × durée : 3 h dès 9 h (traverse le pic de midi) > 3 h dès 16 h (finit hors fenêtre)', () => {
    const matin = estimateVitaminD({ ...base, heure: '09:00', dureeMin: 180 });
    const finJournee = estimateVitaminD({ ...base, heure: '16:00', dureeMin: 180 });
    expect(matin).toBeGreaterThan(finJournee);
  });

  it('une sortie longue démarrée tard vaut plus que son seul point de départ (intégrale, pas instantané)', () => {
    // Départ 18 h en été : l'instant initial est faible mais pas nul, et 2 h
    // n'apportent presque plus rien en fin de course.
    const dix = estimateVitaminD({ ...base, heure: '18:00', dureeMin: 10 });
    const deuxHeures = estimateVitaminD({ ...base, heure: '18:00', dureeMin: 120 });
    expect(deuxHeures).toBeGreaterThan(dix);
    expect(deuxHeures).toBeLessThan(dix * 12); // rendement décroissant vers 20 h (fenêtre fermée)
  });

  it('interconnexion saison × heure : 9 h est utile en juillet mais hors fenêtre en mars', () => {
    expect(estimateVitaminD({ ...base, heure: '09:00', dureeMin: 30 })).toBeGreaterThan(0);
    expect(estimateVitaminD({ ...base, date: '2026-03-10', heure: '09:00', dureeMin: 30 })).toBe(0);
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
