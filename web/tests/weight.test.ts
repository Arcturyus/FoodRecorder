import { describe, expect, it } from 'vitest';
import { computeWeight } from '../src/weight/compute';
import { DEFAULT_WEIGHT_CONFIG } from '../src/weight/types';
import { SEED_WEIGHT_ENTRIES } from '../src/weight/seed';

// Constantes du CSV : taille 1,815 m · âge 23 · sexe M.
const config = DEFAULT_WEIGHT_CONFIG;

describe('formules de pesée (référence stats balance.csv)', () => {
  it('reproduit la 1re ligne du CSV (67,6 kg, muscle 55,1 %)', () => {
    const c = computeWeight({ poids: 67.6, masseMusculaire: 55.1 }, config, 'homme');
    expect(c.imc).toBeCloseTo(20.52, 2);
    expect(c.bmrHarrisBenedict).toBeCloseTo(1734.45, 1);
    expect(c.bmrMifflinStJeor).toBeCloseTo(1700.38, 1);
    expect(c.masseMusculaireSquelettique).toBeCloseTo(33.52, 2);
  });

  it('reproduit une autre ligne (65,5 kg, muscle 54,8 %)', () => {
    const c = computeWeight({ poids: 65.5, masseMusculaire: 54.8 }, config, 'homme');
    expect(c.imc).toBeCloseTo(19.88, 2);
    expect(c.bmrHarrisBenedict).toBeCloseTo(1706.31, 1);
    expect(c.bmrMifflinStJeor).toBeCloseTo(1679.38, 1);
    expect(c.masseMusculaireSquelettique).toBeCloseTo(32.3, 2);
  });

  it('sans masse musculaire, la squelettique est nulle (non calculable)', () => {
    const c = computeWeight({ poids: 70 }, config, 'homme');
    expect(c.masseMusculaireSquelettique).toBeNull();
    expect(c.imc).toBeGreaterThan(0);
  });

  it('utilise la formule femme pour Mifflin-St Jeor', () => {
    const h = computeWeight({ poids: 60 }, config, 'homme');
    const f = computeWeight({ poids: 60 }, config, 'femme');
    // Femme = Homme - 166 (le +5 devient -161).
    expect(h.bmrMifflinStJeor - f.bmrMifflinStJeor).toBeCloseTo(166, 5);
  });
});

describe('seed importé du CSV', () => {
  it('contient toutes les journées datées (41)', () => {
    expect(SEED_WEIGHT_ENTRIES).toHaveLength(41);
    expect(SEED_WEIGHT_ENTRIES[0].date).toBe('2025-09-18');
    expect(SEED_WEIGHT_ENTRIES.at(-1)!.date).toBe('2026-03-20');
  });

  it('parse correctement les décimales FR (poids, masse osseuse)', () => {
    const first = SEED_WEIGHT_ENTRIES[0];
    expect(first.poids).toBeCloseTo(67.6, 5);
    expect(first.masseOsseuse).toBeCloseTo(3.1, 5);
    expect(first.graisseViscerale).toBe(5);
    expect(first.metabolismeBasalMachine).toBe(1694);
  });

  it('conserve les remarques (y compris guillemets internes)', () => {
    const withNote = SEED_WEIGHT_ENTRIES.find((e) => e.remarque?.includes('en même temps'));
    expect(withNote).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Date/heure dictées dans une pesée (« hier matin 68 kg »)
// ---------------------------------------------------------------------------

import { parseWeightDate, parseWeightRules } from '../src/extraction/weight';

// Vendredi 10 juillet 2026, 15 h.
const NOW = new Date('2026-07-10T15:00:00');

describe('parseWeightDate (dates relatives dictées)', () => {
  it('« hier matin » → veille à 08:00', () => {
    expect(parseWeightDate('hier matin 68,5 kg', NOW)).toEqual({ date: '2026-07-09', heure: '08:00' });
  });

  it('« avant-hier soir » → J-2 à 20:00', () => {
    expect(parseWeightDate('avant-hier soir 69 kilos', NOW)).toEqual({ date: '2026-07-08', heure: '20:00' });
  });

  it('« il y a 3 jours » → J-3', () => {
    expect(parseWeightDate('il y a 3 jours 68 kg', NOW).date).toBe('2026-07-07');
  });

  it('« lundi » → le lundi passé le plus proche', () => {
    expect(parseWeightDate('lundi 69 kg', NOW).date).toBe('2026-07-06');
  });

  it('le jour de semaine courant désigne la semaine passée (jamais le futur)', () => {
    expect(parseWeightDate('vendredi 69 kg', NOW).date).toBe('2026-07-03');
  });

  it('heure explicite « à 7h30 »', () => {
    expect(parseWeightDate('68 kg à 7h30', NOW).heure).toBe('07:30');
  });

  it('sans mention de jour ni de moment, ne renvoie rien', () => {
    expect(parseWeightDate('68,5 kg masse grasse 18', NOW)).toEqual({});
  });
});

describe('parseWeightRules avec date dictée', () => {
  it('extrait poids + date + heure + à jeun', () => {
    const p = parseWeightRules('hier matin 68,5 kg à jeun');
    expect(p.poids).toBeCloseTo(68.5, 5);
    expect(p.heure).toBe('08:00');
    expect(p.aJeun).toBe(true);
    expect(p.date).toBeDefined();
  });
});
