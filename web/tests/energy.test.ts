/**
 * Moteur de dépense énergétique. Deux choses valent d'être verrouillées :
 * l'indépendance des postes (c'est toute la raison d'être du modèle additif —
 * marcher peu et s'entraîner beaucoup doit être exprimable), et la correction du
 * TEF, qui empêche l'app de sur-promettre une perte de poids d'environ 10 %.
 */

import { describe, expect, it } from 'vitest';
import {
  computeEnergy,
  bmrMifflinStJeor,
  bmrCunningham,
  protRecommandeParKg,
  KCAL_PER_KG_FAT,
  DAYS_PER_MONTH,
  TEF_RATIO,
  resolveBmrKey,
} from '../src/nutrition/energy';
import type { EnergyInput } from '../src/nutrition/energy';

/** Profil de référence : 66 kg, 1,815 m, 23 ans, musculation 5,5 h/sem, peu de marche. */
const base: EnergyInput = {
  sexe: 'homme',
  poids: 66,
  tailleCm: 181.5,
  age: 23,
  pasParJour: 5500,
  posture: 'assis',
  sportHeures: 5.5,
  sportType: 'muscu',
  formule: 'auto',
  kcalFactor: 1,
};

describe('formules de métabolisme de base', () => {
  it('Mifflin-St Jeor sur le cas de référence', () => {
    expect(Math.round(bmrMifflinStJeor(66, 181.5, 23, 'homme'))).toBe(1684);
  });

  it('Cunningham dépend de la masse maigre, pas du poids total', () => {
    expect(Math.round(bmrCunningham(54.8))).toBe(1706);
  });

  it("retient Mifflin sans masse grasse, Cunningham dès qu'elle est connue", () => {
    expect(computeEnergy(base).bmrKey).toBe('mifflin');
    expect(computeEnergy({ ...base, masseGrassePct: 17 }).bmrKey).toBe('cunningham');
  });

  it('respecte un choix explicite de formule', () => {
    const e = computeEnergy({ ...base, masseGrassePct: 17, formule: 'mifflin' });
    expect(e.bmrKey).toBe('mifflin');
  });

  it('ignore un pourcentage de masse grasse aberrant', () => {
    expect(computeEnergy({ ...base, masseGrassePct: 0 }).masseMaigre).toBeNull();
    expect(computeEnergy({ ...base, masseGrassePct: 95 }).bmrKey).toBe('mifflin');
  });
});

describe('postes de dépense indépendants', () => {
  it('le sport augmente la dépense sans toucher au NEAT', () => {
    const sans = computeEnergy({ ...base, sportHeures: 0 });
    const avec = computeEnergy(base);
    expect(avec.neatPas).toBe(sans.neatPas);
    expect(avec.sport).toBeGreaterThan(sans.sport);
  });

  it('la marche augmente la dépense sans toucher au sport', () => {
    const peu = computeEnergy(base);
    const beaucoup = computeEnergy({ ...base, pasParJour: 12500 });
    expect(beaucoup.sport).toBe(peu.sport);
    expect(beaucoup.neatPas).toBeGreaterThan(peu.neatPas);
  });

  it('un même volume de cardio coûte plus qu’un volume de musculation', () => {
    const muscu = computeEnergy(base).sport;
    const cardio = computeEnergy({ ...base, sportType: 'cardio' }).sport;
    expect(cardio).toBeGreaterThan(muscu);
  });

  it('la posture assise ne coûte rien de plus, le métier physique beaucoup', () => {
    expect(computeEnergy(base).neatPosture).toBe(0);
    expect(computeEnergy({ ...base, posture: 'physique' }).neatPosture).toBeGreaterThan(300);
  });

  it('les postes additionnés, digestion comprise, font la dépense totale', () => {
    const e = computeEnergy(base);
    expect(e.bmr + e.neatPas + e.neatPosture + e.sport + e.tef).toBe(e.tdee);
    expect(e.tef / e.tdee).toBeCloseTo(TEF_RATIO, 2);
  });
});

describe('objectif et prévision de poids', () => {
  it('au maintien, la cible est la dépense et le poids ne bouge pas', () => {
    const e = computeEnergy(base);
    expect(Math.abs(e.cible - e.tdee)).toBeLessThanOrEqual(5); // arrondi à la dizaine
    expect(Math.abs(e.kgParMois)).toBeLessThan(0.05);
  });

  it("l'écart réel est amputé de la digestion économisée, pas égal à l'écart affiché", () => {
    const e = computeEnergy({ ...base, kcalFactor: 0.8 });
    const affiche = e.tdee - e.cible;
    expect(e.ecartReel).toBeCloseTo(affiche * (1 - TEF_RATIO), 5);
    expect(e.ecartReel).toBeLessThan(affiche);
  });

  it('convertit le déficit en kilos par mois', () => {
    const e = computeEnergy({ ...base, kcalFactor: 0.8 });
    expect(e.kgParMois).toBeCloseTo((-e.ecartReel * DAYS_PER_MONTH) / KCAL_PER_KG_FAT, 5);
    expect(e.kgParMois).toBeLessThan(0); // une perte est négative
  });

  it('un surplus fait prendre du poids', () => {
    expect(computeEnergy({ ...base, kcalFactor: 1.1 }).kgParMois).toBeGreaterThan(0);
  });

  it('les bornes encadrent la prévision centrale', () => {
    const e = computeEnergy({ ...base, kcalFactor: 0.8 });
    const [bas, haut] = [e.kgParMoisMin, e.kgParMoisMax].sort((a, b) => a - b);
    expect(bas).toBeLessThan(e.kgParMois);
    expect(haut).toBeGreaterThan(e.kgParMois);
  });
});

describe('protéines conseillées', () => {
  it('montent avec le volume d’entraînement', () => {
    expect(protRecommandeParKg(6, 'muscu', 'maintien')).toBeGreaterThan(
      protRecommandeParKg(0, 'muscu', 'maintien'),
    );
  });

  it('la musculation en demande plus que le cardio à volume égal', () => {
    expect(protRecommandeParKg(6, 'muscu', 'maintien')).toBeGreaterThan(
      protRecommandeParKg(6, 'cardio', 'maintien'),
    );
  });

  it('le déficit relève le besoin (préserver le muscle)', () => {
    expect(protRecommandeParKg(5.5, 'muscu', 'perte')).toBeGreaterThan(
      protRecommandeParKg(5.5, 'muscu', 'maintien'),
    );
  });

  it('reste dans une fourchette défendable même à volume extrême', () => {
    const v = protRecommandeParKg(30, 'muscu', 'perte');
    expect(v).toBeGreaterThanOrEqual(1.2);
    expect(v).toBeLessThanOrEqual(2.6);
  });
});

/**
 * Les quatre formules sont sélectionnables une par une, et pas seulement affichées
 * dans le tableau comparatif. Le point délicat est le repli : deux d'entre elles
 * exigent la masse maigre, qui peut manquer au moment du choix ou disparaître
 * ensuite (pesée supprimée, masse grasse effacée du profil).
 */
describe('choix de la formule de métabolisme', () => {
  const avecMg: EnergyInput = { ...base, masseGrassePct: 17 };

  it.each(['mifflin', 'roza', 'cunningham', 'katch'] as const)('« %s » est retenue telle quelle', (formule) => {
    expect(computeEnergy({ ...avecMg, formule }).bmrKey).toBe(formule);
  });

  it('les quatre donnent quatre valeurs distinctes', () => {
    const valeurs = (['mifflin', 'roza', 'cunningham', 'katch'] as const).map(
      (formule) => computeEnergy({ ...avecMg, formule }).bmr,
    );
    expect(new Set(valeurs).size).toBe(4);
  });

  it('Katch-McArdle tombe environ 130 kcal sous Cunningham', () => {
    const katch = computeEnergy({ ...avecMg, formule: 'katch' }).bmr;
    const cunningham = computeEnergy({ ...avecMg, formule: 'cunningham' }).bmr;
    expect(cunningham - katch).toBeGreaterThan(100);
    expect(cunningham - katch).toBeLessThan(160);
  });

  it('une formule à masse maigre se replie sur Mifflin quand la masse grasse manque', () => {
    expect(computeEnergy({ ...base, formule: 'cunningham' }).bmrKey).toBe('mifflin');
    expect(computeEnergy({ ...base, formule: 'katch' }).bmrKey).toBe('mifflin');
  });

  it('une formule sans masse maigre reste retenue même sans masse grasse', () => {
    expect(computeEnergy({ ...base, formule: 'roza' }).bmrKey).toBe('roza');
  });

  it('« ffm », l’ancien libellé enregistré dans les profils, vaut toujours Cunningham', () => {
    expect(computeEnergy({ ...avecMg, formule: 'ffm' }).bmrKey).toBe('cunningham');
    expect(resolveBmrKey('ffm', true)).toBe('cunningham');
  });

  it('resolveBmrKey couvre les deux replis vers Mifflin', () => {
    expect(resolveBmrKey('auto', false)).toBe('mifflin');
    expect(resolveBmrKey('auto', true)).toBe('cunningham');
    expect(resolveBmrKey('katch', false)).toBe('mifflin');
  });

  it('le BMR retenu est bien celui du tableau comparatif', () => {
    const e = computeEnergy({ ...avecMg, formule: 'roza' });
    expect(e.estimates.find((est) => est.key === e.bmrKey)?.value).toBe(e.bmr);
  });
});
