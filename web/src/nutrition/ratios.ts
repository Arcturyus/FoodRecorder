import type { NutrientKey, Nutrients } from './types';

/**
 * Rapports nutritionnels optimaux. Certains bénéfices ne dépendent pas de la
 * quantité absolue d'un nutriment mais de son équilibre avec un autre — c'est
 * souvent ce rapport qui pilote l'inflammation, la tension ou la santé osseuse.
 *
 * `better` indique le sens de l'optimum :
 *  - 'lower'  : plus le rapport est bas, mieux c'est (cible = maximum toléré) ;
 *  - 'higher' : plus le rapport est haut, mieux c'est (cible = minimum souhaité) ;
 *  - 'target' : viser une valeur, une fourchette de ± `tolerance` autour restant idéale.
 */

export type RatioDirection = 'lower' | 'higher' | 'target';
export type RatioStatus = 'good' | 'warn' | 'bad' | 'na';

export interface RatioDef {
  key: string;
  label: string;
  num: NutrientKey;
  den: NutrientKey;
  optimal: number;
  better: RatioDirection;
  /** goal 'target' : demi-largeur de la fourchette idéale (fraction, ex. 0.35 = ±35 %). */
  tolerance?: number;
  /** Formatage du rapport (ex. « 4:1 »). */
  suffix: string;
  role: string;
  note: string;
}

export const RATIOS: RatioDef[] = [
  {
    key: 'o6o3',
    label: 'Oméga-6 / Oméga-3',
    num: 'omega6',
    den: 'omega3',
    optimal: 4,
    better: 'lower',
    suffix: ':1',
    role: 'Équilibre inflammatoire. Les oméga-6 sont pro-inflammatoires, les oméga-3 anti-inflammatoires.',
    note: 'L\'alimentation moderne atteint souvent 15:1 à 20:1. Viser ≤ 4:1 (idéalement 1:1 à 4:1) en augmentant les oméga-3 (poissons gras, colza, lin, noix) et en limitant les huiles riches en oméga-6.',
  },
  {
    key: 'kna',
    label: 'Potassium / Sodium',
    num: 'potassium',
    den: 'sodium',
    optimal: 2,
    better: 'higher',
    suffix: ':1',
    role: 'Régulation de la tension artérielle et de l\'équilibre hydrique.',
    note: 'L\'OMS recommande davantage de potassium que de sodium. Viser ≥ 2:1 (plus de fruits/légumes, moins de sel et de produits transformés) protège le cœur et la tension.',
  },
  {
    key: 'camg',
    label: 'Calcium / Magnésium',
    num: 'calcium',
    den: 'magnesium',
    optimal: 2,
    better: 'target',
    tolerance: 0.5,
    suffix: ':1',
    role: 'Ces deux minéraux sont antagonistes (contraction vs relâchement musculaire, os).',
    note: 'Un rapport autour de 2:1 est considéré comme optimal. Trop de calcium par rapport au magnésium (fréquent avec beaucoup de produits laitiers) peut nuire à l\'absorption du magnésium.',
  },
];

export interface RatioResult {
  def: RatioDef;
  value: number | null;
  status: RatioStatus;
  /** Rapport formaté prêt à afficher (ex. « 3,2:1 » ou « — »). */
  text: string;
}

function statusFor(def: RatioDef, value: number): RatioStatus {
  const { optimal, better, tolerance = 0.35 } = def;
  if (better === 'lower') {
    if (value <= optimal) return 'good';
    if (value <= optimal * 2.5) return 'warn';
    return 'bad';
  }
  if (better === 'higher') {
    if (value >= optimal) return 'good';
    if (value >= optimal * 0.5) return 'warn';
    return 'bad';
  }
  // target : fourchette idéale autour de `optimal`.
  const dev = Math.abs(value - optimal) / optimal;
  if (dev <= tolerance) return 'good';
  if (dev <= tolerance * 2) return 'warn';
  return 'bad';
}

/** Calcule un rapport à partir de totaux (renvoie null si le dénominateur est nul). */
export function computeRatio(def: RatioDef, totals: Nutrients): RatioResult {
  const den = totals[def.den];
  const num = totals[def.num];
  if (!den || den <= 0 || num <= 0) {
    return { def, value: null, status: 'na', text: '—' };
  }
  const value = num / den;
  const decimals = value < 10 ? 1 : 0;
  return {
    def,
    value,
    status: statusFor(def, value),
    text: `${value.toLocaleString('fr-FR', { maximumFractionDigits: decimals })}${def.suffix}`,
  };
}

export function computeRatios(totals: Nutrients): RatioResult[] {
  return RATIOS.map((def) => computeRatio(def, totals));
}
