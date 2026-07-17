import type { FoodCategory, Unit } from '../nutrition/types';

export function round(n: number, d = 0): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function fmt(n: number, d = 0): string {
  return round(n, d).toLocaleString('fr-FR');
}

export const UNIT_LABELS: Record<Unit, string> = {
  g: 'g',
  mg: 'mg',
  µg: 'µg',
  ml: 'ml',
  piece: 'pièce(s)',
  portion: 'portion(s)',
  cas: 'c. à soupe',
  cac: 'c. à café',
  bol: 'bol(s)',
  verre: 'verre(s)',
  assiette: 'assiette(s)',
  tranche: 'tranche(s)',
  poignee: 'poignée(s)',
  carre: 'carré(s)',
  pot: 'pot(s)',
  pincee: 'pincée(s)',
  dose: 'dose(s)',
};

/** Libellés lisibles des catégories d'aliments, dans l'ordre d'affichage. */
export const CATEGORY_LABELS: { key: FoodCategory; label: string }[] = [
  { key: 'fruit', label: 'Fruits' },
  { key: 'legume', label: 'Légumes' },
  { key: 'feculent', label: 'Féculents' },
  { key: 'viande', label: 'Viandes' },
  { key: 'poisson', label: 'Poissons' },
  { key: 'oeuf-laitier', label: 'Œufs & laitages' },
  { key: 'sucre-snack', label: 'Sucré / snacks' },
  { key: 'matiere-grasse', label: 'Matières grasses' },
  { key: 'boisson', label: 'Boissons' },
  { key: 'plat', label: 'Plats' },
  { key: 'supplement', label: 'Compléments & assaisonnements' },
  { key: 'autre', label: 'Autres' },
];
