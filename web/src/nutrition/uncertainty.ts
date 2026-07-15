import type { Unit } from './types';

/**
 * Incertitude estimée sur les calories d'une journée.
 *
 * Deux sources d'erreur par item, combinées en quadrature :
 * - la QUANTITÉ : fourchette explicite fournie par l'IA (quantiteMin/Max) si
 *   présente, sinon un forfait selon l'unité (grammes pesés ≪ bol/assiette) ;
 * - les VALEURS pour 100 g : variabilité naturelle d'un aliment de la base,
 *   estimation IA (hors base) ou matching flou (douteux).
 *
 * Le total du jour agrège les ± par item en somme QUADRATIQUE (erreurs
 * largement indépendantes → compensation partielle) : 5 items à ±100 kcal
 * donnent ±224 kcal, pas ±500. Calculé à la volée : fonctionne aussi sur tout
 * l'historique antérieur à la fonctionnalité.
 */

/** Sous-ensemble de JournalItem utilisé ici (évite d'importer le store). */
export interface UncertainItem {
  nomAffiche: string;
  quantite: number;
  unite: Unit;
  estimation: boolean;
  douteux: boolean;
  nutrients: { kcal: number };
  quantiteMin?: number;
  quantiteMax?: number;
  iaEstime?: object;
  customN?: object;
}

export interface UncertainEntry {
  transcript: string;
  items: UncertainItem[];
}

/** Incertitude relative forfaitaire sur la quantité, par unité. */
const UNIT_REL: Record<Unit, number> = {
  // mesures explicites (pesée, volume)
  g: 0.05,
  mg: 0.05,
  µg: 0.05,
  ml: 0.05,
  // pièces comptées : le nombre est sûr, le poids unitaire varie
  piece: 0.15,
  tranche: 0.15,
  pot: 0.08,
  carre: 0.15,
  dose: 0.1,
  cas: 0.25,
  cac: 0.25,
  pincee: 0.3,
  // contenants flous : volume ET remplissage devinés
  verre: 0.2,
  bol: 0.3,
  portion: 0.3,
  assiette: 0.35,
  poignee: 0.35,
};

/** Quantité choisie par l'IA faute d'indication (« estimation »: true). */
const REL_QUANTITE_ESTIMEE = 0.3;
/** Quantité devinée visuellement sur une photo. */
const REL_QUANTITE_PHOTO = 0.35;
/** Variabilité naturelle d'un aliment de la base (variété, cuisson). */
const REL_VALEURS_BASE = 0.08;
/** Nutriments /100 g estimés par l'IA pour un aliment hors base. */
const REL_VALEURS_IA = 0.25;
/** Matching flou : l'aliment retenu peut être une variante assez différente. */
const REL_VALEURS_DOUTEUX = 0.25;

export interface KcalUncertainty {
  /** Demi-fourchette (± kcal) sur le total du jour. */
  pm: number;
  /** Items les plus incertains (± kcal décroissant) — pour cibler quoi peser. */
  top: { nom: string; pm: number }[];
}

/** Une entrée dont les quantités viennent d'une photo. */
export function isPhotoEntry(entry: Pick<UncertainEntry, 'transcript'>): boolean {
  return entry.transcript.startsWith('📷');
}

/** ± kcal d'un item : incertitudes quantité et valeurs combinées en quadrature. */
export function itemKcalUncertainty(item: UncertainItem, fromPhoto = false): number {
  let relQ: number;
  if (item.quantiteMin != null && item.quantiteMax != null && item.quantite > 0) {
    // Fourchette explicite de l'IA : elle remplace le forfait.
    relQ = (item.quantiteMax - item.quantiteMin) / (2 * item.quantite);
  } else {
    relQ = UNIT_REL[item.unite] ?? 0.2;
    if (item.estimation) relQ = Math.max(relQ, REL_QUANTITE_ESTIMEE);
    if (fromPhoto) relQ = Math.max(relQ, REL_QUANTITE_PHOTO);
  }
  // customN : valeurs ajustées par l'utilisateur → considérées fiables.
  const relV = item.customN
    ? REL_VALEURS_BASE
    : item.iaEstime
      ? REL_VALEURS_IA
      : item.douteux
        ? REL_VALEURS_DOUTEUX
        : REL_VALEURS_BASE;
  return Math.hypot(relQ, relV) * item.nutrients.kcal;
}

/** ± kcal du total d'une journée (somme quadratique des ± par item). */
export function dayKcalUncertainty(entries: UncertainEntry[]): KcalUncertainty {
  const contribs: { nom: string; pm: number }[] = [];
  for (const e of entries) {
    const photo = isPhotoEntry(e);
    for (const it of e.items) {
      const pm = itemKcalUncertainty(it, photo);
      if (pm > 0) contribs.push({ nom: it.nomAffiche, pm });
    }
  }
  const pm = Math.sqrt(contribs.reduce((a, c) => a + c.pm * c.pm, 0));
  const top = contribs.sort((a, b) => b.pm - a.pm).slice(0, 3);
  return { pm, top };
}
