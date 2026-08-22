/**
 * Valeurs nutritionnelles pour 100 g d'aliment.
 * Unités : kcal ; g pour macros/fibres/créatine/collagène ; mg pour fer→sodium, vitC, vitE ;
 * µg pour sélénium, iode, vitA (EAR), vitD, B9, B12, K1, K2.
 */
export interface Nutrients {
  kcal: number;
  proteines: number;
  glucides: number;
  lipides: number;
  fibres: number;
  /**
   * g d'éthanol pur. 7 kcal/g : des calories qui n'apparaissent dans aucune des
   * trois macros — sans ce champ, les 43 kcal d'une bière ou les 83 kcal d'un
   * verre de vin sortaient de nulle part et creusaient l'écart entre les kcal de
   * la table et celles reconstituées. Un verre standard ≈ 10 g.
   */
  alcool: number;
  /**
   * g — TOTAL des acides gras saturés. Fourre-tout : il additionne des acides
   * gras qui ne se comportent pas pareil (cf. les deux sous-ensembles ci-dessous).
   * Sert de filet de sécurité (plafond haut) ; le vrai plafond porte sur
   * `agSaturesLdl`.
   */
  agSatures: number;
  /**
   * g — palmitique (C16:0) + myristique (C14:0), sous-ensemble d'`agSatures`.
   * Ce sont EUX qui font monter le LDL (beurre, crème, fromage, viande grasse,
   * huile de palme) : c'est sur eux que porte le plafond qui compte.
   */
  agSaturesLdl: number;
  /**
   * g — acide stéarique (C18:0), sous-ensemble d'`agSatures`. Le « neutre » :
   * le foie le désature vite en acide oléique, il ne fait pas monter le LDL
   * (chocolat noir, bœuf, agneau). Repère haut, poids faible.
   */
  agSaturesStearique: number;
  agTrans: number; // g (huiles hydrogénées, fritures ; trace naturelle chez les ruminants)
  agMonoInsatures: number; // g (total AG mono-insaturés)
  agPolyInsatures: number; // g (total AG poly-insaturés)
  /**
   * g — équivalent oméga-3 EFFECTIF (ALA/10 + EPA + DHA), utilisé par les
   * cibles/rapports/score : l'ALA est mal converti par le corps en EPA/DHA
   * (~10 % de rendement), donc pondéré 10× moins que l'EPA/DHA directs. La
   * répartition réelle (non pondérée) est dans omega3Ala/Epa/Dha ci-dessous.
   */
  omega3: number;
  omega6: number; // g (acide linoléique surtout) — sous-ensemble des poly-insaturés
  omega9: number; // g (acide oléique surtout) — sous-ensemble des mono-insaturés
  /** g — acide alpha-linolénique BRUT (avant pondération), sous-ensemble végétal de omega3. */
  omega3Ala: number;
  /** g — EPA (acide eicosapentaénoïque) BRUT, sous-ensemble marin/animal de omega3. */
  omega3Epa: number;
  /** g — DHA (acide docosahexaénoïque) BRUT, sous-ensemble marin/animal de omega3. */
  omega3Dha: number;
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
  collagene: number; // g (sous-ensemble des protéines : tissus conjonctifs animaux, nul dans les végétaux)
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
  /**
   * Provenance dans MA banque (absent ⇒ aliment du catalogue de référence, qui
   * n'est jamais compté dans les stats) :
   *  - 'catalogue' : copié depuis le catalogue à la 1re consommation (garde son id) ;
   *  - 'ia'        : né d'une estimation d'IA forte pour un aliment hors catalogue ;
   *  - 'manuel'    : saisi à la main dans l'onglet Banque.
   */
  origine?: 'catalogue' | 'ia' | 'manuel';
  /** id du catalogue dont cet aliment est la copie : permet le « ↺ rétablir ». */
  sourceId?: string;
  /** Valeurs estimées par l'IA, jamais relues par l'utilisateur (badge « à vérifier »). */
  aVerifier?: boolean;
  /** Jour d'entrée dans la banque (YYYY-MM-DD). */
  ajouteLe?: string;
}

/** Item extrait d'une phrase (contrat central du plan, §3) */
export interface ExtractedItem {
  aliment: string;
  quantite: number;
  unite: Unit;
  estimation: boolean;
  /**
   * Fourchette plausible de la quantité (même unité que `quantite`), fournie par
   * une IA forte quand elle ESTIME la quantité (photo surtout). Sert au calcul
   * d'incertitude des totaux ; absente quand la quantité est donnée par l'utilisateur.
   */
  quantiteMin?: number;
  quantiteMax?: number;
  /**
   * Valeurs nutritionnelles (pour 100 g) estimées par une IA forte (API Claude /
   * pont Claude Code) quand l'aliment n'existe PAS dans la base : dans ce cas
   * l'IA renseigne TOUS les nutriments. Absent pour les aliments de la base
   * (résolus par matching) et pour les moteurs légers (règles / IA locale).
   */
  nutriments?: Nutrients;
  /** Catégorie de l'aliment estimé par l'IA (accompagne `nutriments`). */
  categorie?: FoodCategory;
  /** Poids moyen en g d'une pièce, pour convertir « piece » d'un aliment estimé. */
  grammesParPiece?: number;
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
  /** Nutriments issus d'une estimation IA (aliment hors base) plutôt que du matching. */
  aiEstime?: boolean;
}

export const EMPTY_NUTRIENTS: Nutrients = {
  kcal: 0, proteines: 0, glucides: 0, lipides: 0, fibres: 0, alcool: 0,
  agSatures: 0, agSaturesLdl: 0, agSaturesStearique: 0,
  agTrans: 0, agMonoInsatures: 0, agPolyInsatures: 0, omega3: 0, omega6: 0, omega9: 0,
  omega3Ala: 0, omega3Epa: 0, omega3Dha: 0,
  fer: 0, magnesium: 0, potassium: 0, calcium: 0, zinc: 0, sodium: 0,
  selenium: 0, iode: 0,
  vitA: 0, vitC: 0, vitD: 0, vitE: 0, vitK1: 0, vitK2: 0,
  vitB1: 0, vitB2: 0, vitB3: 0, vitB5: 0, vitB6: 0, vitB9: 0, vitB12: 0,
  creatine: 0, collagene: 0,
};
