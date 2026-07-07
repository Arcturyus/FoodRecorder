import type { NutrientKey } from './types';

/**
 * Apports de référence quotidiens (adulte) — ANSES/EU NRV, valeurs indicatives.
 * Créatine : pas d'AJR officiel ; cible indicative 3 g/j (synthèse endogène ~1 g/j incluse).
 * Sodium : limite haute plutôt qu'objectif à atteindre.
 */
export interface RdaEntry {
  key: NutrientKey;
  label: string;
  unit: 'kcal' | 'g' | 'mg' | 'µg';
  rda: number;
  /** true si la valeur est une limite à ne pas dépasser (sodium, AGS) */
  upperLimit?: boolean;
}

export const RDA: RdaEntry[] = [
  { key: 'kcal', label: 'Calories', unit: 'kcal', rda: 2200 },
  { key: 'proteines', label: 'Protéines', unit: 'g', rda: 60 },
  { key: 'glucides', label: 'Glucides', unit: 'g', rda: 260 },
  { key: 'lipides', label: 'Lipides', unit: 'g', rda: 80 },
  { key: 'fibres', label: 'Fibres', unit: 'g', rda: 30 },
  { key: 'agSatures', label: 'AG saturés', unit: 'g', rda: 24, upperLimit: true },
  { key: 'fer', label: 'Fer', unit: 'mg', rda: 14 },
  { key: 'magnesium', label: 'Magnésium', unit: 'mg', rda: 375 },
  { key: 'potassium', label: 'Potassium', unit: 'mg', rda: 3500 },
  { key: 'calcium', label: 'Calcium', unit: 'mg', rda: 950 },
  { key: 'zinc', label: 'Zinc', unit: 'mg', rda: 11 },
  { key: 'sodium', label: 'Sodium', unit: 'mg', rda: 2300, upperLimit: true },
  { key: 'selenium', label: 'Sélénium', unit: 'µg', rda: 70 },
  { key: 'iode', label: 'Iode', unit: 'µg', rda: 150 },
  { key: 'vitA', label: 'Vitamine A', unit: 'µg', rda: 750 },
  { key: 'vitC', label: 'Vitamine C', unit: 'mg', rda: 110 },
  { key: 'vitD', label: 'Vitamine D', unit: 'µg', rda: 15 },
  { key: 'vitE', label: 'Vitamine E', unit: 'mg', rda: 10 },
  { key: 'vitK1', label: 'Vitamine K1', unit: 'µg', rda: 79 },
  { key: 'vitK2', label: 'Vitamine K2', unit: 'µg', rda: 100 },
  { key: 'vitB9', label: 'Vitamine B9', unit: 'µg', rda: 330 },
  { key: 'vitB12', label: 'Vitamine B12', unit: 'µg', rda: 4 },
  { key: 'creatine', label: 'Créatine', unit: 'g', rda: 3 },
];
