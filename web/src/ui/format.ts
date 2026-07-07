import type { Unit } from '../nutrition/types';

export function round(n: number, d = 0): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function fmt(n: number, d = 0): string {
  return round(n, d).toLocaleString('fr-FR');
}

export const UNIT_LABELS: Record<Unit, string> = {
  g: 'g',
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
};
