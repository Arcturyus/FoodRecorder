/**
 * Formules dérivées des pesées. Toutes vérifiées sur `stats balance.csv`
 * (taille 1,815 m · âge 23 · sexe M · multiplicateur 1,55) :
 *   67,6 kg → IMC 20,52 · HB 1734,45 · MSJ 1700,38 · squelettique 33,52.
 */

import type { WeightComputed, WeightConfig } from './types';
import type { Sex } from '../nutrition/targets';

interface WeightInput {
  poids: number;
  masseMusculaire?: number; // %
}

/** Facteur empirique du tableur : squelettique = masse musculaire (kg) × 0,9. */
const SKELETAL_FACTOR = 0.9;

/** Harris-Benedict révisé (Roza & Shakir, 1984), kcal/j. */
function harrisBenedict(poids: number, tailleCm: number, age: number, sexe: Sex): number {
  return sexe === 'homme'
    ? 88.362 + 13.397 * poids + 4.799 * tailleCm - 5.677 * age
    : 447.593 + 9.247 * poids + 3.098 * tailleCm - 4.33 * age;
}

/** Mifflin-St Jeor, kcal/j. */
function mifflinStJeor(poids: number, tailleCm: number, age: number, sexe: Sex): number {
  const base = 10 * poids + 6.25 * tailleCm - 5 * age;
  return sexe === 'homme' ? base + 5 : base - 161;
}

export function computeWeight(entry: WeightInput, config: WeightConfig, sexe: Sex): WeightComputed {
  const { poids } = entry;
  const tailleCm = config.taille * 100;
  const bmrHarrisBenedict = harrisBenedict(poids, tailleCm, config.age, sexe);
  const bmrMifflinStJeor = mifflinStJeor(poids, tailleCm, config.age, sexe);

  const masseMusculaireSquelettique =
    entry.masseMusculaire != null ? poids * (entry.masseMusculaire / 100) * SKELETAL_FACTOR : null;

  return {
    masseMusculaireSquelettique,
    bmrHarrisBenedict,
    bmrMifflinStJeor,
    imc: config.taille > 0 ? poids / (config.taille * config.taille) : 0,
    tmaHB: bmrHarrisBenedict * config.activityMultiplier,
    tmaMSJ: bmrMifflinStJeor * config.activityMultiplier,
  };
}
