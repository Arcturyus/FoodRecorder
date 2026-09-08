/**
 * Formules dérivées des pesées. Toutes vérifiées sur `stats balance.csv`
 * (taille 1,815 m · âge 23 · sexe M) :
 *   67,6 kg → IMC 20,52 · HB 1734,45 · MSJ 1700,38 · squelettique 33,52.
 */

import type { WeightComputed, WeightConfig } from './types';
import type { Sex } from '../nutrition/targets';
// Les formules vivent dans le moteur de dépense énergétique, qui pilote aussi les
// cibles quotidiennes : une seule implémentation, donc pas de divergence possible
// entre le métabolisme affiché sur une pesée et celui qui calcule vos objectifs.
import { bmrRozaShizgal as harrisBenedict, bmrMifflinStJeor as mifflinStJeor } from '../nutrition/energy';

interface WeightInput {
  poids: number;
  masseMusculaire?: number; // %
}

/** Facteur empirique du tableur : squelettique = masse musculaire (kg) × 0,9. */
const SKELETAL_FACTOR = 0.9;

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
  };
}
