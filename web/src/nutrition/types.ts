/**
 * Valeurs nutritionnelles pour 100 g d'aliment.
 * Unités : kcal ; g pour macros/fibres/créatine ; mg pour fer→sodium, vitC, vitE ;
 * µg pour sélénium, iode, vitA (EAR), vitD, B9, B12, K1, K2.
 */
export interface Nutrients {
  kcal: number;
  proteines: number;
  glucides: number;
  lipides: number;
  fibres: number;
  agSatures: number;
  // minéraux (mg)
  fer: number;
  magnesium: number;
  potassium: number;
  calcium: number;
  zinc: number;
  sodium: number;
  // oligo-éléments (µg)
  selenium: number;
  iode: number;
  // vitamines
  vitA: number; // µg équivalent rétinol
  vitC: number; // mg
  vitD: number; // µg
  vitE: number; // mg
  vitK1: number; // µg
  vitK2: number; // µg (MK-4/MK-7, valeurs manuelles — absentes de CIQUAL)
  vitB9: number; // µg
  vitB12: number; // µg
  // autres
  creatine: number; // g (viandes/poissons, valeurs manuelles)
}

export type NutrientKey = keyof Nutrients;

export const UNITS = [
  'g',
  'ml',
  'piece',
  'portion',
  'cas',
  'cac',
  'bol',
  'verre',
  'assiette',
  'tranche',
  'poignee',
  'carre',
  'pot',
] as const;

export type Unit = (typeof UNITS)[number];

export type FoodCategory =
  | 'fruit'
  | 'legume'
  | 'feculent'
  | 'viande'
  | 'poisson'
  | 'oeuf-laitier'
  | 'sucre-snack'
  | 'matiere-grasse'
  | 'boisson'
  | 'plat'
  | 'autre';

export interface Food {
  id: string;
  nom: string;
  categorie: FoodCategory;
  /** synonymes/formulations orales ("steak" → steak haché…) */
  aliases: string[];
  /** poids moyen en g d'une pièce (1 banane, 1 œuf…) si pertinent */
  pieceGrams?: number;
  /** surcharges par unité (ex. tranche de pain = 30 g, pot de yaourt = 125 g) */
  unitGrams?: Partial<Record<Unit, number>>;
  /** pour 100 g */
  n: Nutrients;
  /** aliment ajouté par l'utilisateur */
  custom?: boolean;
}

/** Item extrait d'une phrase (contrat central du plan, §3) */
export interface ExtractedItem {
  aliment: string;
  quantite: number;
  unite: Unit;
  estimation: boolean;
}

export interface MatchResult {
  food: Food | null;
  score: number;
  douteux: boolean;
  alternatives: Food[];
}

export interface ComputedItem {
  extracted: ExtractedItem;
  match: MatchResult;
  grams: number;
  nutrients: Nutrients | null;
}

export const EMPTY_NUTRIENTS: Nutrients = {
  kcal: 0, proteines: 0, glucides: 0, lipides: 0, fibres: 0, agSatures: 0,
  fer: 0, magnesium: 0, potassium: 0, calcium: 0, zinc: 0, sodium: 0,
  selenium: 0, iode: 0,
  vitA: 0, vitC: 0, vitD: 0, vitE: 0, vitK1: 0, vitK2: 0, vitB9: 0, vitB12: 0,
  creatine: 0,
};
