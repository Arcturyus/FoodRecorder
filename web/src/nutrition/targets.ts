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
  /**
   * Intensité du déficit calorique, en % sous le maintien (objectif « perte »).
   * Ajustable : chacun peut se connaître (données d'un autre suivi, ressenti…).
   * Absent ⇒ valeur par défaut `DEFICIT_DEFAULT`.
   */
  deficitPct?: number;
  /** Intensité du surplus calorique, en % au-dessus du maintien (objectif « muscle »). */
  surplusPct?: number;
}

export const DEFAULT_PROFILE: Profile = {
  sexe: 'homme',
  poids: 70,
  activite: 'sportif',
  objectif: 'maintien',
  deficitPct: 20,
  surplusPct: 10,
};

/** Réglages par défaut et bornes recommandées du déficit / surplus (en %). */
export const DEFICIT_DEFAULT = 20;
export const SURPLUS_DEFAULT = 10;
/** min/max autorisés dans l'UI ; `safeMax` = seuil au-delà duquel on alerte. */
export const DEFICIT_BOUNDS = { min: 5, max: 30, safeMax: 25 } as const;
export const SURPLUS_BOUNDS = { min: 3, max: 25, safeMax: 20 } as const;

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

/** Bonus de protéines (g/kg) : plus haut en sèche (préserver le muscle) et en prise de masse. */
const OBJECTIVE_PROT_BONUS: Record<Objective, number> = { maintien: 0, perte: 0.4, muscle: 0.3 };

/** % effectif de déficit/surplus retenu pour un profil (valeur bornée). */
export function objectivePct(profile: Profile): number {
  if (profile.objectif === 'perte') {
    const v = profile.deficitPct ?? DEFICIT_DEFAULT;
    return Math.min(DEFICIT_BOUNDS.max, Math.max(DEFICIT_BOUNDS.min, v));
  }
  if (profile.objectif === 'muscle') {
    const v = profile.surplusPct ?? SURPLUS_DEFAULT;
    return Math.min(SURPLUS_BOUNDS.max, Math.max(SURPLUS_BOUNDS.min, v));
  }
  return 0;
}

/** Facteur calorique appliqué au maintien selon l'objectif et son intensité réglée. */
export function objectiveKcalFactor(profile: Profile): number {
  const pct = objectivePct(profile);
  if (profile.objectif === 'perte') return 1 - pct / 100;
  if (profile.objectif === 'muscle') return 1 + pct / 100;
  return 1;
}

export interface ObjectiveAdvice {
  /** Intensité perçue, du plus doux au plus marqué. */
  level: 'doux' | 'modéré' | 'soutenu' | 'agressif';
  text: string;
  /** Vrai si l'intensité dépasse la zone recommandée (à afficher en alerte). */
  warn: boolean;
}

/**
 * Conseil « garde-fou » selon l'objectif et l'intensité choisie : garde l'utilisateur
 * dans une fourchette raisonnable (ni trop mou, ni trop agressif) sans l'empêcher
 * d'ajuster s'il se connaît.
 */
export function objectiveAdvice(profile: Profile): ObjectiveAdvice | null {
  const pct = objectivePct(profile);
  if (profile.objectif === 'perte') {
    if (pct < 10) return { level: 'doux', warn: false, text: `Déficit léger (~${pct} %) : perte lente et confortable, facile à tenir dans la durée.` };
    if (pct <= 20) return { level: 'modéré', warn: false, text: `Déficit modéré (~${pct} %) : bon compromis perte de gras / préservation du muscle et de l'énergie.` };
    if (pct <= DEFICIT_BOUNDS.safeMax) return { level: 'soutenu', warn: false, text: `Déficit soutenu (~${pct} %) : perte rapide, veillez à garder des protéines élevées et de la force à l'entraînement.` };
    return { level: 'agressif', warn: true, text: `Déficit agressif (~${pct} %) : risque de fonte musculaire, de fatigue et de fringales. À réserver au court terme, avec beaucoup de protéines.` };
  }
  if (profile.objectif === 'muscle') {
    if (pct < 8) return { level: 'doux', warn: false, text: `Surplus léger (~${pct} %) : prise de masse « propre », très peu de gras, idéale pour un bon niveau d'entraînement.` };
    if (pct <= 15) return { level: 'modéré', warn: false, text: `Surplus modéré (~${pct} %) : bon rythme de prise de muscle avec une prise de gras limitée.` };
    if (pct <= SURPLUS_BOUNDS.safeMax) return { level: 'soutenu', warn: false, text: `Surplus soutenu (~${pct} %) : prise de masse rapide, mais une part ira au gras — surveillez le poids.` };
    return { level: 'agressif', warn: true, text: `Surplus agressif (~${pct} %) : au-delà de ce que le muscle peut construire, l'excédent part surtout en gras. Rarement utile.` };
  }
  return null;
}

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
  /** Seuil de prudence haut (cf. `RdaEntry.upper`) — absent si aucun excès connu. */
  upper?: number;
  /** Dose où des effets délétères ont été observés (cf. `RdaEntry.toxic`). */
  toxic?: number;
  /** Compat. : vrai si c'est une limite (goal === 'limit'). */
  upperLimit?: boolean;
  /** Sous-détail d'un autre nutriment : pas de tuile propre dans le bilan (cf. RdaEntry.parent). */
  parent?: NutrientKey;
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
  // L'intensité du déficit/surplus est réglable (objectiveKcalFactor), avec garde-fous.
  const kcalOptimal = Math.round((poids * KCAL_PER_KG[activite] * sexFactor * objectiveKcalFactor(profile)) / 10) * 10;
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
      ...(r.parent ? { parent: r.parent } : {}),
      ...(r.upper !== undefined ? { upper: r.upper } : {}),
      ...(r.toxic !== undefined ? { toxic: r.toxic } : {}),
    };

    if (r.key === 'kcal') {
      return { ...base, ajr: Math.round((poids * 31 * sexFactor) / 10) * 10, optimal: kcalOptimal };
    }
    // Protéines : les seuls seuils hauts proportionnels au poids. 3,5 g/kg =
    // début de la zone où le foie peine à évacuer l'azote, 4,5 g/kg = la dose du
    // « mal du lapin » (~35 % de l'énergie). Rien à voir avec le rein sain, qui
    // encaisse 2,5-3,3 g/kg sans dommage mesuré.
    if (r.key === 'proteines') {
      return {
        ...base,
        ajr: Math.round(poids * 0.83),
        optimal: protOptimal,
        upper: Math.round(poids * 3.5),
        toxic: Math.round(poids * 4.5),
      };
    }
    // Objectif « limite » : plafond = ajr, cible basse idéale = optimalLow.
    if (r.goal === 'limit') {
      return { ...base, ajr: r.rda, optimal: r.optimalLow ?? r.rda };
    }
    // Fer : 9 mg suffisent chez l'homme (pertes faibles). Chez la femme, ce sont
    // les règles qui creusent le besoin — 15 à 18 mg en moyenne sur le cycle,
    // et jusqu'à 27 mg enceinte (cf. le Guide). Hors règles, le besoin rejoint
    // celui de l'homme : la cible retenue est donc une moyenne, pas un maximum.
    if (r.key === 'fer' && sexe === 'femme') {
      return { ...base, ajr: 15, optimal: 18 };
    }
    const factor = r.optimalFactor ?? 1;
    return { ...base, ajr: r.rda, optimal: Math.round(r.rda * factor) };
  });
}
