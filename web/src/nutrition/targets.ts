import type { NutrientKey } from './types';
import { RDA } from './rda';
import type { Goal } from './rda';

/**
 * Objectifs nutritionnels personnalisés. Deux niveaux, dont l'interprétation
 * dépend de l'objectif (`goal`) du nutriment :
 *
 *  - goal `atLeast` (la plupart des nutriments) :
 *      `ajr`     = apport de référence, le plancher à couvrir ;
 *      `optimal` = cible « santé/sport » plus haute (≥ ajr).
 *  - goal `limit` (sodium, AG saturés) — on cherche l'inverse, le plus bas possible :
 *      `ajr`     = plafond à ne pas dépasser ;
 *      `optimal` = cible basse idéale (≤ ajr).
 *
 * Le profil par défaut est un homme sportif de 70 kg, mais tout est ajustable.
 */

export type { Goal } from './rda';
export type Sex = 'homme' | 'femme';
export type Activity = 'sedentaire' | 'modere' | 'sportif' | 'intense';
/** Objectif de composition corporelle : ajuste calories et protéines cibles. */
export type Objective = 'maintien' | 'perte' | 'muscle';

export interface Profile {
  sexe: Sex;
  poids: number; // kg
  activite: Activity;
  objectif: Objective;
}

export const DEFAULT_PROFILE: Profile = { sexe: 'homme', poids: 70, activite: 'sportif', objectif: 'maintien' };

export const ACTIVITY_LABELS: Record<Activity, string> = {
  sedentaire: 'Sédentaire',
  modere: 'Modéré (3-4 séances/sem.)',
  sportif: 'Sportif (5-6 séances/sem.)',
  intense: 'Intense / compétition',
};

export const OBJECTIVE_LABELS: Record<Objective, string> = {
  maintien: 'Maintien',
  perte: 'Perte de poids',
  muscle: 'Prise de muscle',
};

/** Facteur appliqué aux calories de maintien selon l'objectif (déficit / surplus). */
const OBJECTIVE_KCAL: Record<Objective, number> = { maintien: 1, perte: 0.8, muscle: 1.1 };
/** Bonus de protéines (g/kg) : plus haut en sèche (préserver le muscle) et en prise de masse. */
const OBJECTIVE_PROT_BONUS: Record<Objective, number> = { maintien: 0, perte: 0.4, muscle: 0.3 };

export interface Target {
  key: NutrientKey;
  label: string;
  unit: 'kcal' | 'g' | 'mg' | 'µg';
  goal: Goal;
  /** atLeast : plancher à couvrir. limit : plafond à ne pas dépasser. */
  ajr: number;
  /** atLeast : cible haute « performance ». limit : cible basse idéale. */
  optimal: number;
  role: string;
  optimalNote?: string;
  /** Compat. : vrai si c'est une limite (goal === 'limit'). */
  upperLimit?: boolean;
}

/** Calories par kg de poids selon le niveau d'activité (maintien). */
const KCAL_PER_KG: Record<Activity, number> = { sedentaire: 31, modere: 35, sportif: 40, intense: 45 };
/** Protéines par kg de poids selon le niveau d'activité. */
const PROT_PER_KG: Record<Activity, number> = { sedentaire: 0.9, modere: 1.4, sportif: 1.8, intense: 2.2 };

export function computeTargets(profile: Profile): Target[] {
  const { poids, activite, sexe } = profile;
  const objectif = profile.objectif ?? 'maintien'; // profil persisté avant l'ajout de l'objectif
  const sexFactor = sexe === 'homme' ? 1 : 0.87; // besoin énergétique moyen plus faible

  // Objectif : déficit (perte) ou surplus (muscle) sur les calories, protéines relevées.
  const kcalOptimal = Math.round((poids * KCAL_PER_KG[activite] * sexFactor * OBJECTIVE_KCAL[objectif]) / 10) * 10;
  const protOptimal = Math.round(poids * (PROT_PER_KG[activite] + OBJECTIVE_PROT_BONUS[objectif]));

  return RDA.map((r): Target => {
    const base = {
      key: r.key,
      label: r.label,
      unit: r.unit,
      goal: r.goal,
      role: r.role,
      optimalNote: r.optimalNote,
      upperLimit: r.goal === 'limit',
    };

    if (r.key === 'kcal') {
      return { ...base, ajr: Math.round((poids * 31 * sexFactor) / 10) * 10, optimal: kcalOptimal };
    }
    if (r.key === 'proteines') {
      return { ...base, ajr: Math.round(poids * 0.83), optimal: protOptimal };
    }
    // Objectif « limite » : plafond = ajr, cible basse idéale = optimalLow.
    if (r.goal === 'limit') {
      return { ...base, ajr: r.rda, optimal: r.optimalLow ?? r.rda };
    }
    // Fer : besoin plus élevé chez la femme (menstruations).
    if (r.key === 'fer' && sexe === 'femme') {
      return { ...base, ajr: 16, optimal: 20 };
    }
    const factor = r.optimalFactor ?? 1;
    return { ...base, ajr: r.rda, optimal: Math.round(r.rda * factor) };
  });
}
