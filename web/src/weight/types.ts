/**
 * Suivi des pesées (balance connectée). Une entrée = une mesure horodatée avec
 * les champs relevés par la balance ; les champs dérivés (IMC, métabolismes,
 * masse musculaire squelettique…) sont recalculés à la volée par `computeWeight`.
 */

import type { Sex } from '../nutrition/targets';
import type { ExtractionSource } from '../extraction/providers';

export interface WeightEntry {
  id: string;
  date: string; // YYYY-MM-DD
  heure: string; // HH:MM (important, modifiable)
  aJeun: boolean;
  nu: boolean;
  poids: number; // kg (requis)
  // champs de composition corporelle relevés par la balance (optionnels)
  masseGrasse?: number; // %
  eau?: number; // %
  masseMusculaire?: number; // %
  masseOsseuse?: number; // kg
  graisseViscerale?: number; // indice sans unité
  metabolismeBasalMachine?: number; // kcal (donné par la balance)
  remarque?: string; // note libre (cas particulier)
  createdAt: number;
  source: ExtractionSource;
}

/**
 * Mensurations prises ponctuellement au mètre ruban. Elles restent séparées
 * des pesées : on peut mesurer un tour de taille sans se peser ce jour-là.
 */
export interface BodyMeasurementEntry {
  id: string;
  date: string; // YYYY-MM-DD
  measurementProtocol?: string;
  waistCm?: number;
  upperArmLeftCm?: number;
  upperArmRightCm?: number;
  chestEmptyLungsCm?: number;
  shoulderCm?: number;
  hipCm?: number;
  calfLeftCm?: number;
  calfRightCm?: number;
  neckCm?: number;
  thighLeftCm?: number;
  thighRightCm?: number;
  forearmLeftCm?: number;
  forearmRightCm?: number;
  createdAt: number;
}

export const BODY_MEASUREMENT_FIELDS: { key: Exclude<keyof BodyMeasurementEntry, 'id' | 'date' | 'measurementProtocol' | 'createdAt'>; label: string }[] = [
  { key: 'waistCm', label: 'Tour de taille' },
  { key: 'upperArmLeftCm', label: 'Bras gauche' },
  { key: 'upperArmRightCm', label: 'Bras droit' },
  { key: 'chestEmptyLungsCm', label: 'Poitrine (poumons vides)' },
  { key: 'shoulderCm', label: 'Épaules' },
  { key: 'hipCm', label: 'Hanches' },
  { key: 'calfLeftCm', label: 'Mollet gauche' },
  { key: 'calfRightCm', label: 'Mollet droit' },
  { key: 'neckCm', label: "Cou (sous la pomme d’Adam)" },
  { key: 'thighLeftCm', label: 'Cuisse gauche' },
  { key: 'thighRightCm', label: 'Cuisse droite' },
  { key: 'forearmLeftCm', label: 'Avant-bras gauche' },
  { key: 'forearmRightCm', label: 'Avant-bras droit' },
];

/** Constantes personnelles servant aux formules dérivées (éditables dans l'UI). */
export interface WeightConfig {
  taille: number; // m
  age: number; // années
  /** Objectif de poids (kg) affiché en ligne cible sur le graphique (optionnel). */
  objectifPoids?: number;
}

export const DEFAULT_WEIGHT_CONFIG: WeightConfig = {
  taille: 1.815,
  age: 23,
};

/** Champs dérivés recalculés à partir d'une pesée + des constantes + du sexe. */
export interface WeightComputed {
  /** Masse musculaire squelettique estimée (kg) = poids × muscle% × 0,9. */
  masseMusculaireSquelettique: number | null;
  /** Métabolisme de base Harris-Benedict (révision 1984), kcal. */
  bmrHarrisBenedict: number;
  /** Métabolisme de base Mifflin-St Jeor, kcal. */
  bmrMifflinStJeor: number;
  /** Indice de masse corporelle. */
  imc: number;
}

/** Clés numériques traçables sur les courbes (mesurées + poids). */
export type WeightMetricKey =
  | 'poids'
  | 'masseGrasse'
  | 'eau'
  | 'masseMusculaire'
  | 'masseOsseuse'
  | 'graisseViscerale'
  | 'metabolismeBasalMachine';

export interface WeightMetric {
  key: WeightMetricKey;
  label: string;
  unit: string;
}

/** Métadonnées d'affichage des métriques (ordre = ordre du CSV). */
export const WEIGHT_METRICS: WeightMetric[] = [
  { key: 'poids', label: 'Poids', unit: 'kg' },
  { key: 'masseGrasse', label: 'Masse grasse', unit: '%' },
  { key: 'eau', label: 'Eau', unit: '%' },
  { key: 'masseMusculaire', label: 'Masse musculaire', unit: '%' },
  { key: 'masseOsseuse', label: 'Masse osseuse', unit: 'kg' },
  { key: 'graisseViscerale', label: 'Graisse viscérale', unit: '' },
  { key: 'metabolismeBasalMachine', label: 'Métabolisme basal (balance)', unit: 'kcal' },
];

// Réexport pour les consommateurs qui n'importent que ce module.
export type { Sex };
