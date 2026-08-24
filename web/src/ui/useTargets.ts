import { useMemo } from 'react';
import { useStore } from '../store/store';
import { computeTargets, computeEnergyFor } from '../nutrition/targets';
import type { BodyContext, Target } from '../nutrition/targets';
import type { EnergyBreakdown } from '../nutrition/energy';

/**
 * Les cibles quotidiennes dépendent de trois sources qui vivaient jusqu'ici
 * séparément : le profil (sexe, poids, objectif, activité), les constantes de
 * pesée (taille, âge) et la composition corporelle relevée par la balance.
 * Ce hook les réunit — passer par lui garantit que tous les écrans affichent
 * exactement les mêmes objectifs.
 */

/** Dernier % de masse grasse relevé, du plus récent au plus ancien. */
function derniereMasseGrasse(entries: { date: string; heure: string; masseGrasse?: number }[]): number | undefined {
  let best: { cle: string; valeur: number } | null = null;
  for (const e of entries) {
    if (e.masseGrasse == null) continue;
    const cle = `${e.date} ${e.heure}`;
    if (!best || cle > best.cle) best = { cle, valeur: e.masseGrasse };
  }
  return best?.valeur;
}

/** Taille, âge et masse grasse mesurée — le contexte corporel des formules de métabolisme. */
export function useBody(): BodyContext {
  const weightConfig = useStore((s) => s.weightConfig);
  const weightEntries = useStore((s) => s.weightEntries);
  const masseGrassePct = useMemo(() => derniereMasseGrasse(weightEntries), [weightEntries]);

  return useMemo(
    () => ({
      tailleCm: Math.round(weightConfig.taille * 100),
      age: weightConfig.age,
      ...(masseGrassePct !== undefined ? { masseGrassePct } : {}),
    }),
    [weightConfig.taille, weightConfig.age, masseGrassePct],
  );
}

/** Objectifs nutritionnels du profil courant, réglages personnels compris. */
export function useTargets(): Target[] {
  const profile = useStore((s) => s.profile);
  const overrides = useStore((s) => s.nutrientTargets);
  const body = useBody();
  return useMemo(() => computeTargets(profile, body, overrides), [profile, body, overrides]);
}

/**
 * Les mêmes objectifs SANS les réglages personnels : c'est la valeur « conseillée »
 * affichée à côté de chaque champ, et celle vers laquelle le ↺ ramène. Sans elle,
 * régler une cible serait irréversible de fait — on ne saurait plus d'où l'on part.
 */
export function useDefaultTargets(): Target[] {
  const profile = useStore((s) => s.profile);
  const body = useBody();
  return useMemo(() => computeTargets(profile, body), [profile, body]);
}

/** Décomposition de la dépense énergétique du profil courant. */
export function useEnergy(): EnergyBreakdown {
  const profile = useStore((s) => s.profile);
  const body = useBody();
  return useMemo(() => computeEnergyFor(profile, body), [profile, body]);
}
