import { useCallback, useState } from 'react';

/**
 * Préférences d'AFFICHAGE, par navigateur — repli d'une section, tri d'une
 * grille, cartes de repas compactes ou non.
 *
 * Elles vivent volontairement hors du store zustand, et donc hors de la synchro
 * de profil : replier le bilan sur le téléphone ne doit rien changer sur
 * l'ordinateur, où l'écran est trois fois plus grand. Une donnée de profil
 * (poids, cibles, importances) voyage ; un pli d'écran, non.
 */

/** Espace de stockage des sections repliables (cf. Section.tsx). */
export const SECTIONS_STORE = 'foodrecorder-sections';
/** Espace des autres réglages d'affichage (tri du bilan, repas compacts…). */
export const UI_STORE = 'foodrecorder-ui';

function readMap(store: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(store);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Valeur enregistrée pour `id`, ou `fallback` si absente ou illisible. */
export function readPref<T>(store: string, id: string, fallback: T): T {
  const v = readMap(store)[id];
  return v === undefined ? fallback : (v as T);
}

export function writePref(store: string, id: string, value: unknown): void {
  try {
    localStorage.setItem(store, JSON.stringify({ ...readMap(store), [id]: value }));
  } catch {
    // Navigation privée, quota plein : le réglage marche quand même pendant la
    // session, il ne survit simplement pas au rechargement. Rien à signaler.
  }
}

/** `useState` qui se souvient : même signature, valeur persistée par navigateur. */
export function useUiPref<T>(store: string, id: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(store, id, initial));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writePref(store, id, next);
    },
    [store, id],
  );
  return [value, update];
}
