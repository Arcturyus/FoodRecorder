import type { NutrientKey } from './types';
import { RDA } from './rda';
import type { Goal } from './rda';
import { computeEnergy, protRecommandeParKg, PROT_BOUNDS } from './energy';
import type { BmrFormula, EnergyBreakdown, Sex, SportType, WorkPosture } from './energy';

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
export type { Sex, SportType, WorkPosture, BmrFormula } from './energy';
/**
 * Ancien réglage « niveau d'activité » : un seul curseur pour la marche et le sport.
 * Conservé pour les profils déjà enregistrés (et la synchro), mais il ne sert plus
 * qu'à deviner des valeurs de départ pour les réglages séparés — cf. `energyInputs`.
 */
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

  // --- Dépense énergétique : postes réglables séparément (cf. nutrition/energy.ts).
  // Tous optionnels : un profil enregistré avant cette version les déduit d'`activite`.
  /** Pas par jour (hors séances de sport). */
  pasParJour?: number;
  /** Posture dominante dans la journée de travail — indépendante des pas. */
  posture?: WorkPosture;
  /** Volume de sport, en heures par semaine (lissé sur 7 jours). */
  sportHeures?: number;
  /** Nature dominante des séances : pilote leur coût calorique et le conseil protéines. */
  sportType?: SportType;
  /** Protéines voulues (g/kg/j). Absent ⇒ la valeur conseillée, recalculée à chaque changement. */
  protParKg?: number;
  /** Formule de métabolisme de base retenue. `auto` = masse maigre si elle est connue. */
  bmrFormule?: BmrFormula;
  /** % de masse grasse saisi à la main — sinon celui de la dernière pesée qui en porte un. */
  masseGrassePct?: number;
}

export const DEFAULT_PROFILE: Profile = {
  sexe: 'homme',
  poids: 70,
  activite: 'sportif',
  objectif: 'maintien',
  deficitPct: 20,
  surplusPct: 10,
  pasParJour: 5500,
  posture: 'assis',
  sportHeures: 5,
  sportType: 'muscu',
  bmrFormule: 'auto',
};

/**
 * Mesures du corps qui ne vivent pas dans le profil : taille et âge viennent des
 * constantes de pesée (`weightConfig`), le % de masse grasse de la dernière pesée
 * qui en comporte un. `useTargets` les rassemble ; les valeurs ici ne servent que
 * de secours si le contexte n'est pas fourni.
 */
export interface BodyContext {
  tailleCm: number;
  age: number;
  /** % de masse grasse mesuré (la saisie manuelle du profil est prioritaire). */
  masseGrassePct?: number;
}

export const DEFAULT_BODY: BodyContext = { tailleCm: 175, age: 30 };

/** Valeurs de départ des postes de dépense pour un profil qui n'a que l'ancien `activite`. */
const ACTIVITY_FALLBACK: Record<Activity, { pasParJour: number; sportHeures: number; sportType: SportType }> = {
  sedentaire: { pasParJour: 3500, sportHeures: 0, sportType: 'mixte' },
  modere: { pasParJour: 6000, sportHeures: 3.5, sportType: 'mixte' },
  sportif: { pasParJour: 7000, sportHeures: 5.5, sportType: 'mixte' },
  intense: { pasParJour: 8500, sportHeures: 9, sportType: 'mixte' },
};

/** Postes de dépense effectifs d'un profil (réglages explicites, ou déduits de l'ancien niveau). */
export function energySettings(profile: Profile): {
  pasParJour: number;
  posture: WorkPosture;
  sportHeures: number;
  sportType: SportType;
  bmrFormule: BmrFormula;
} {
  const fb = ACTIVITY_FALLBACK[profile.activite] ?? ACTIVITY_FALLBACK.modere;
  return {
    pasParJour: profile.pasParJour ?? fb.pasParJour,
    posture: profile.posture ?? 'assis',
    sportHeures: profile.sportHeures ?? fb.sportHeures,
    sportType: profile.sportType ?? fb.sportType,
    bmrFormule: profile.bmrFormule ?? 'auto',
  };
}

/** Décomposition complète de la dépense pour un profil et un corps donnés. */
export function computeEnergyFor(profile: Profile, body: BodyContext = DEFAULT_BODY): EnergyBreakdown {
  const s = energySettings(profile);
  return computeEnergy({
    sexe: profile.sexe,
    poids: profile.poids,
    tailleCm: body.tailleCm,
    age: body.age,
    masseGrassePct: profile.masseGrassePct ?? body.masseGrassePct,
    pasParJour: s.pasParJour,
    posture: s.posture,
    sportHeures: s.sportHeures,
    sportType: s.sportType,
    formule: s.bmrFormule,
    kcalFactor: objectiveKcalFactor(profile),
  });
}

/** Protéines conseillées (g/kg) pour ce profil — le point de repère du réglage libre. */
export function protConseilParKg(profile: Profile): number {
  const s = energySettings(profile);
  return protRecommandeParKg(s.sportHeures, s.sportType, profile.objectif ?? 'maintien');
}

/** Protéines effectivement visées (g/kg) : le réglage libre, borné, ou le conseil. */
export function protParKgEffectif(profile: Profile): number {
  const v = profile.protParKg;
  if (v == null || !Number.isFinite(v)) return protConseilParKg(profile);
  return Math.min(PROT_BOUNDS.max, Math.max(PROT_BOUNDS.min, v));
}

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
  /** Seuil de carence réelle (cf. `RdaEntry.lowThreshold`) — absent si le guide n'en fixe aucun. */
  lowThreshold?: number;
  /** Effet documenté sous `lowThreshold` (cf. `RdaEntry.lowNote`). */
  lowNote?: string;
  /** Compat. : vrai si c'est une limite (goal === 'limit'). */
  upperLimit?: boolean;
  /** Sous-détail d'un autre nutriment : pas de tuile propre dans le bilan (cf. RdaEntry.parent). */
  parent?: NutrientKey;
}

export function computeTargets(profile: Profile, body: BodyContext = DEFAULT_BODY): Target[] {
  const { poids, sexe } = profile;

  // Calories : métabolisme de base réel + NEAT + sport + digestion, puis déficit ou
  // surplus selon l'objectif (cf. nutrition/energy.ts). Les protéines suivent le
  // volume d'entraînement, et restent réglables à la main.
  const energy = computeEnergyFor(profile, body);
  const kcalOptimal = energy.cible;
  const kcalMaintien = energy.tdee;
  const protOptimal = Math.round(poids * protParKgEffectif(profile));

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
      ...(r.lowThreshold !== undefined ? { lowThreshold: r.lowThreshold } : {}),
      ...(r.lowNote !== undefined ? { lowNote: r.lowNote } : {}),
    };

    // Calories : le plancher n'est plus un forfait au kilo mais le métabolisme de
    // base lui-même — manger durablement en dessous, c'est puiser dans le muscle.
    // La cible « optimale » est la dépense totale corrigée de l'objectif.
    if (r.key === 'kcal') {
      return { ...base, ajr: Math.round(energy.bmr / 10) * 10, optimal: kcalOptimal };
    }
    // Protéines : les seuls seuils hauts proportionnels au poids. 3,5 g/kg =
    // début de la zone où le foie peine à évacuer l'azote, 4,5 g/kg = la dose du
    // « mal du lapin » (~35 % de l'énergie). Rien à voir avec le rein sain, qui
    // encaisse 2,5-3,3 g/kg sans dommage mesuré. Seuil de carence (bilan azoté
    // négatif) : 0,66 g/kg, cf. le Guide.
    if (r.key === 'proteines') {
      return {
        ...base,
        ajr: Math.round(poids * 0.83),
        optimal: protOptimal,
        upper: Math.round(poids * 3.5),
        toxic: Math.round(poids * 4.5),
        lowThreshold: Math.round(poids * 0.66),
      };
    }
    // Objectif « limite » : plafond = ajr, cible basse idéale = optimalLow.
    if (r.goal === 'limit') {
      return { ...base, ajr: r.rda, optimal: r.optimalLow ?? r.rda };
    }
    // Lipides : seuil de carence à ~20 % de l'énergie (cf. le Guide), calculé sur
    // le maintien plutôt que sur la cible optimale — sinon un déficit calorique
    // assumé (objectif « perte ») ferait mécaniquement baisser ce seuil.
    if (r.key === 'lipides') {
      return { ...base, ajr: r.rda, optimal: r.rda, lowThreshold: Math.round((0.2 * kcalMaintien) / 9) };
    }
    // Fer : 9 mg suffisent chez l'homme (pertes faibles). Chez la femme, ce sont
    // les règles qui creusent le besoin — 15 à 18 mg en moyenne sur le cycle,
    // et jusqu'à 27 mg enceinte (cf. le Guide). Hors règles, le besoin rejoint
    // celui de l'homme : la cible retenue est donc une moyenne, pas un maximum.
    if (r.key === 'fer' && sexe === 'femme') {
      return { ...base, ajr: 15, optimal: 18, lowThreshold: 10 };
    }
    const factor = r.optimalFactor ?? 1;
    return { ...base, ajr: r.rda, optimal: Math.round(r.rda * factor) };
  });
}
