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
  agMonoInsatures: number; // g (total AG mono-insaturés)
  agPolyInsatures: number; // g (total AG poly-insaturés)
  omega3: number; // g (ALA + EPA + DHA) — sous-ensemble des poly-insaturés
  omega6: number; // g (acide linoléique surtout) — sous-ensemble des poly-insaturés
  omega9: number; // g (acide oléique surtout) — sous-ensemble des mono-insaturés
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
  vitB1: number; // mg (thiamine)
  vitB2: number; // mg (riboflavine)
  vitB3: number; // mg (niacine / PP)
  vitB5: number; // mg (acide pantothénique)
  vitB6: number; // mg (pyridoxine)
  vitB9: number; // µg
  vitB12: number; // µg
  // autres
  creatine: number; // g (viandes/poissons, valeurs manuelles)
}

export type NutrientKey = keyof Nutrients;

export const UNITS = [
  'g',
  'mg',
  'µg',
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
  'pincee',
  'dose',
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
  | 'supplement'
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
  kcal: 0, proteines: 0, glucides: 0, lipides: 0, fibres: 0,
  agSatures: 0, agMonoInsatures: 0, agPolyInsatures: 0, omega3: 0, omega6: 0, omega9: 0,
  fer: 0, magnesium: 0, potassium: 0, calcium: 0, zinc: 0, sodium: 0,
  selenium: 0, iode: 0,
  vitA: 0, vitC: 0, vitD: 0, vitE: 0, vitK1: 0, vitK2: 0,
  vitB1: 0, vitB2: 0, vitB3: 0, vitB5: 0, vitB6: 0, vitB9: 0, vitB12: 0,
  creatine: 0,
};
