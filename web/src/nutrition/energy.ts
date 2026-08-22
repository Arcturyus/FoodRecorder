/**
 * Moteur de dépense énergétique : du métabolisme de base à la cible calorique.
 *
 * Le modèle est **additif**, pour que chaque poste soit réglable séparément —
 * c'est tout l'intérêt par rapport à un multiplicateur unique « niveau d'activité »,
 * qui force à choisir entre « je marche beaucoup » et « je fais du sport » :
 *
 *   BMR            métabolisme de base (au repos complet, à jeun)
 * + NEAT           tout ce qui n'est pas du sport : pas + posture au travail
 * + EAT            le sport, amorti sur la semaine
 * + TEF            digestion (~10 % de ce qui est ingéré)
 * = TDEE           dépense totale (= maintien)
 * × facteur        déficit / surplus selon l'objectif
 * = cible          les kcal du jour
 *
 * Toutes les constantes sont sourcées dans les commentaires. Aucune n'est
 * exacte pour un individu : l'ordre de grandeur des erreurs est donné par
 * `TDEE_UNCERTAINTY_PCT` et rappelé dans l'UI.
 */

/** Sexe biologique, seul paramètre des formules de métabolisme qui ne soit pas mesurable ici. */
export type Sex = 'homme' | 'femme';

// ---------------------------------------------------------------------------
// Métabolisme de base
// ---------------------------------------------------------------------------

/**
 * Mifflin-St Jeor (1990), kcal/j. Retenue comme référence **sans masse grasse** :
 * c'est l'équation que l'Academy of Nutrition and Dietetics recommande depuis son
 * analyse de 2005 (Frankenfield et al.), la plus fiable chez l'adulte non obèse
 * comme obèse — elle tombe à ±10 % du métabolisme mesuré chez ~4 sujets sur 5.
 */
export function bmrMifflinStJeor(poids: number, tailleCm: number, age: number, sexe: Sex): number {
  const base = 10 * poids + 6.25 * tailleCm - 5 * age;
  return sexe === 'homme' ? base + 5 : base - 161;
}

/**
 * Harris-Benedict révisée par Roza & Shizgal (1984), kcal/j. Nettement meilleure
 * que l'originale de 1919 (recalculée sur la base de Boston), mais elle surestime
 * encore d'environ 5 % en moyenne : gardée comme point de comparaison, pas comme
 * base des cibles.
 */
export function bmrRozaShizgal(poids: number, tailleCm: number, age: number, sexe: Sex): number {
  return sexe === 'homme'
    ? 88.362 + 13.397 * poids + 4.799 * tailleCm - 5.677 * age
    : 447.593 + 9.247 * poids + 3.098 * tailleCm - 4.33 * age;
}

/**
 * Cunningham (1980), kcal/j — à partir de la **masse maigre** (FFM), donc du % de
 * masse grasse. Retenue comme référence quand la composition corporelle est connue :
 * chez le sportif entraîné elle bat régulièrement Mifflin et Katch-McArdle
 * (ten Haaf & Weijs 2014 ; Jagim et al. 2018), parce que le muscle est le tissu
 * qui consomme, et qu'à poids égal deux personnes n'en ont pas la même quantité.
 */
export function bmrCunningham(masseMaigre: number): number {
  return 500 + 22 * masseMaigre;
}

/** Katch-McArdle, kcal/j. Même principe que Cunningham, droite quasi parallèle ~130 kcal plus bas. */
export function bmrKatchMcArdle(masseMaigre: number): number {
  return 370 + 21.6 * masseMaigre;
}

// ---------------------------------------------------------------------------
// NEAT — activité hors sport
// ---------------------------------------------------------------------------

/**
 * Coût **net** d'un pas, en kcal par kg de poids de corps (le coût basal, déjà
 * compté dans le BMR, est déduit). Marcher coûte ~0,45 kcal/kg/km net, et il faut
 * ~1300 pas pour un kilomètre : 10 000 pas ≈ 245 kcal pour 70 kg.
 */
export const KCAL_PER_STEP_PER_KG = 0.00035;

/** Posture dominante au travail — indépendante des pas : on peut être debout sans marcher. */
export type WorkPosture = 'assis' | 'alterne' | 'debout' | 'physique';

/**
 * Surcoût de la posture, en kcal/j pour 70 kg (mis à l'échelle du poids réel).
 * Rester debout plutôt qu'assis ne coûte que ~0,2 kcal/min : les bureaux assis-debout
 * pèsent quelques dizaines de kcal, pas des centaines. Le métier physique (manutention,
 * bâtiment, service) est d'un tout autre ordre.
 */
export const POSTURE_KCAL_70: Record<WorkPosture, number> = {
  assis: 0,
  alterne: 60,
  debout: 130,
  physique: 400,
};

export const POSTURE_LABELS: Record<WorkPosture, string> = {
  assis: 'Assis(e) presque tout le temps',
  alterne: 'Alterne assis / debout',
  debout: 'Debout la majorité du temps',
  physique: 'Métier physique (port de charges, service…)',
};

/** Repères de pas/jour proposés en un clic — ils remplissent le champ, qui reste libre. */
export interface StepPreset {
  label: string;
  pas: number;
  hint: string;
}

export const STEP_PRESETS: StepPreset[] = [
  { label: 'Très sédentaire', pas: 3000, hint: 'Domicile-bureau en voiture, peu de sorties à pied.' },
  { label: 'Peu de marche', pas: 5500, hint: 'Quelques trajets courts, une sortie par jour.' },
  { label: 'Marche régulière', pas: 8500, hint: 'Transports en commun, courses à pied, déplacements fréquents.' },
  { label: 'Beaucoup de marche', pas: 12500, hint: 'Ville sans voiture, promenades quotidiennes, métier qui fait bouger.' },
];

// ---------------------------------------------------------------------------
// Sport
// ---------------------------------------------------------------------------

export type SportType = 'muscu' | 'mixte' | 'cardio';

/**
 * Intensité moyenne d'une heure de séance, en MET (Compendium of Physical
 * Activities, Ainsworth et al. 2011) — temps de repos inclus, ce qui explique
 * que la musculation soit plus basse que ce qu'on imagine.
 */
export const SPORT_MET: Record<SportType, number> = { muscu: 5, mixte: 6.5, cardio: 8 };

export const SPORT_LABELS: Record<SportType, string> = {
  muscu: 'Musculation / renforcement',
  mixte: 'Mixte (muscu + cardio, sports collectifs)',
  cardio: 'Cardio / endurance (course, vélo, natation)',
};

/**
 * Dépense du sport, en kcal/jour (volume hebdomadaire lissé sur 7 jours).
 * 1 MET = 1 kcal/kg/h ; on retire 1 MET, le métabolisme de repos étant déjà compté.
 */
export function sportKcalParJour(poids: number, heuresParSemaine: number, type: SportType): number {
  return ((SPORT_MET[type] - 1) * poids * heuresParSemaine) / 7;
}

// ---------------------------------------------------------------------------
// Digestion, conversion en poids, incertitude
// ---------------------------------------------------------------------------

/** Effet thermique des aliments : ~10 % de l'énergie ingérée pour une alimentation mixte. */
export const TEF_RATIO = 0.1;

/**
 * Énergie d'un kilo de tissu adipeux (règle de Wishnofsky, 1958) : 7700 kcal.
 * Valable pour estimer quelques semaines ; au-delà elle surestime la perte, car
 * le corps s'adapte (baisse du NEAT, du BMR) — cf. les modèles de Hall (2011).
 */
export const KCAL_PER_KG_FAT = 7700;

/** Jours d'un mois moyen (365,25 / 12). */
export const DAYS_PER_MONTH = 30.44;

/**
 * Incertitude affichée sur la dépense totale. ±10 % vient de la dispersion propre
 * aux équations de BMR ; s'y ajoutent l'imprécision du NEAT et du coût réel des
 * séances. Volontairement conservateur : 2400 kcal estimées, c'est « entre ~2100
 * et ~2700 ».
 */
export const TDEE_UNCERTAINTY_PCT = 12;

// ---------------------------------------------------------------------------
// Calcul complet
// ---------------------------------------------------------------------------

/**
 * Formule de métabolisme de base retenue pour les cibles. `auto` prend la plus
 * juste possible avec ce qu'on sait du corps : Cunningham dès que la masse maigre
 * est connue, Mifflin sinon. Les autres valeurs forcent une formule précise.
 * `ffm` est l'ancien nom de `cunningham`, gardé pour les profils déjà enregistrés
 * (et la synchro entre appareils) ; `resolveBmrKey` le traduit.
 */
export type BmrFormula = 'auto' | 'mifflin' | 'roza' | 'cunningham' | 'katch' | 'ffm';

export interface EnergyInput {
  sexe: Sex;
  poids: number;
  tailleCm: number;
  age: number;
  /** % de masse grasse (saisi ou repris de la dernière pesée). Absent ⇒ formules sans FFM. */
  masseGrassePct?: number;
  pasParJour: number;
  posture: WorkPosture;
  sportHeures: number; // h/semaine
  sportType: SportType;
  formule: BmrFormula;
  /** Facteur objectif appliqué au maintien (1 = maintien, 0,8 = −20 %…). */
  kcalFactor: number;
}

/** Une estimation de BMR parmi les formules disponibles, pour le comparatif. */
export interface BmrEstimate {
  key: 'mifflin' | 'cunningham' | 'roza' | 'katch';
  label: string;
  value: number;
  /** Vrai si la formule s'appuie sur la masse maigre (donc sur le % de masse grasse). */
  usesFfm: boolean;
  note: string;
}

export interface EnergyBreakdown {
  /** Métabolisme de base retenu (kcal/j). */
  bmr: number;
  /** Formule effectivement retenue. */
  bmrKey: BmrEstimate['key'];
  /** Toutes les estimations, pour la comparaison affichée. */
  estimates: BmrEstimate[];
  masseMaigre: number | null;
  neatPas: number;
  neatPosture: number;
  sport: number;
  tef: number;
  /** Dépense totale = maintien (kcal/j). */
  tdee: number;
  /** Cible du jour après application de l'objectif (kcal/j). */
  cible: number;
  /**
   * Écart énergétique réel (kcal/j) : positif = déficit, négatif = surplus.
   * Ce n'est pas `tdee − cible` : en mangeant moins on digère moins, donc le TEF
   * baisse aussi et l'écart effectif ne vaut que 90 % de la différence affichée.
   */
  ecartReel: number;
  /** Variation de poids prévue (kg/mois) : négative en perte. */
  kgParMois: number;
  /** Bornes basse/haute de cette prévision, avec l'incertitude sur la dépense. */
  kgParMoisMin: number;
  kgParMoisMax: number;
}

/** Les quatre formules sélectionnables, dans l'ordre où l'UI les présente. */
export const BMR_KEYS = ['mifflin', 'roza', 'cunningham', 'katch'] as const;

/** Vrai si la formule a besoin de la masse maigre, donc du % de masse grasse. */
export function bmrNeedsFfm(key: BmrEstimate['key']): boolean {
  return key === 'cunningham' || key === 'katch';
}

/**
 * Traduit le choix de l'utilisateur en formule effectivement calculable.
 *
 * Deux replis, tous deux vers Mifflin — la référence quand la composition
 * corporelle est inconnue :
 *  - `auto` sans masse maigre (le cas de départ, avant toute pesée à impédance) ;
 *  - une formule à masse maigre explicitement choisie, alors que la masse grasse
 *    a disparu depuis (profil vidé, pesée supprimée). Mieux vaut un métabolisme
 *    calculé par une autre formule qu'un panneau en erreur : le repli est signalé
 *    dans l'UI, qui laisse le choix enregistré intact pour le jour où la mesure
 *    revient.
 */
export function resolveBmrKey(formule: BmrFormula, hasFfm: boolean): BmrEstimate['key'] {
  if (formule === 'auto') return hasFfm ? 'cunningham' : 'mifflin';
  // `ffm` : ancien libellé d'avant l'ouverture aux quatre formules.
  const key = formule === 'ffm' ? 'cunningham' : formule;
  if (bmrNeedsFfm(key) && !hasFfm) return 'mifflin';
  return key;
}

/** Masse maigre (kg) à partir du poids et du % de masse grasse. */
export function masseMaigreDe(poids: number, masseGrassePct?: number): number | null {
  if (masseGrassePct == null || !Number.isFinite(masseGrassePct)) return null;
  if (masseGrassePct <= 0 || masseGrassePct >= 70) return null;
  return poids * (1 - masseGrassePct / 100);
}

export function computeEnergy(input: EnergyInput): EnergyBreakdown {
  const { sexe, poids, tailleCm, age, pasParJour, posture, sportHeures, sportType } = input;
  const ffm = masseMaigreDe(poids, input.masseGrassePct);

  const mifflin = bmrMifflinStJeor(poids, tailleCm, age, sexe);
  const roza = bmrRozaShizgal(poids, tailleCm, age, sexe);

  const estimates: BmrEstimate[] = [
    {
      key: 'mifflin',
      label: 'Mifflin-St Jeor',
      value: Math.round(mifflin),
      usesFfm: false,
      note: "Référence sans composition corporelle : l'équation recommandée par l'Academy of Nutrition and Dietetics.",
    },
    {
      key: 'roza',
      label: 'Harris-Benedict révisée (Roza & Shizgal, 1984)',
      value: Math.round(roza),
      usesFfm: false,
      note: 'Correction de la formule de 1919. Bonne, mais surestime encore ~5 % en moyenne.',
    },
  ];

  if (ffm != null) {
    estimates.push(
      {
        key: 'cunningham',
        label: 'Cunningham (masse maigre)',
        value: Math.round(bmrCunningham(ffm)),
        usesFfm: true,
        note: 'La plus juste chez les personnes entraînées — à condition que le % de masse grasse le soit aussi.',
      },
      {
        key: 'katch',
        label: 'Katch-McArdle (masse maigre)',
        value: Math.round(bmrKatchMcArdle(ffm)),
        usesFfm: true,
        note: 'Même logique que Cunningham, résultat systématiquement ~130 kcal plus bas.',
      },
    );
  }

  const bmrKey = resolveBmrKey(input.formule, ffm != null);
  const bmr = estimates.find((e) => e.key === bmrKey)!.value;

  const neatPas = Math.round(pasParJour * poids * KCAL_PER_STEP_PER_KG);
  const neatPosture = Math.round((POSTURE_KCAL_70[posture] * poids) / 70);
  const sport = Math.round(sportKcalParJour(poids, sportHeures, sportType));

  // Le TEF se calcule sur ce qui est ingéré : au maintien, l'apport égale la dépense,
  // d'où tdee = (bmr + neat + sport) / (1 − 10 %).
  const horsTef = bmr + neatPas + neatPosture + sport;
  const tdee = Math.round(horsTef / (1 - TEF_RATIO));
  const tef = tdee - horsTef;

  const cible = Math.round((tdee * input.kcalFactor) / 10) * 10;
  const ecartReel = (tdee - cible) * (1 - TEF_RATIO);
  const kgParMois = (-ecartReel * DAYS_PER_MONTH) / KCAL_PER_KG_FAT;

  // L'incertitude porte sur la dépense : une dépense sous-estimée réduit le déficit réel.
  const marge = (tdee * TDEE_UNCERTAINTY_PCT) / 100;
  const ecartBas = (tdee - marge - cible) * (1 - TEF_RATIO);
  const ecartHaut = (tdee + marge - cible) * (1 - TEF_RATIO);

  return {
    bmr,
    bmrKey,
    estimates,
    masseMaigre: ffm,
    neatPas,
    neatPosture,
    sport,
    tef,
    tdee,
    cible,
    ecartReel,
    kgParMois,
    kgParMoisMin: (-ecartHaut * DAYS_PER_MONTH) / KCAL_PER_KG_FAT,
    kgParMoisMax: (-ecartBas * DAYS_PER_MONTH) / KCAL_PER_KG_FAT,
  };
}

// ---------------------------------------------------------------------------
// Protéines
// ---------------------------------------------------------------------------

/** Bornes du réglage protéines (g/kg de poids de corps) proposées dans l'UI. */
export const PROT_BOUNDS = { min: 0.8, max: 3, safeMax: 2.5 } as const;

/** Gain de protéines conseillé par heure hebdomadaire de sport, selon le type. */
const PROT_PER_SPORT_HOUR: Record<SportType, number> = { muscu: 0.09, mixte: 0.07, cardio: 0.05 };

/**
 * Protéines conseillées (g/kg/j). Base 1,2 g/kg (adulte actif, au-dessus de l'AJR
 * de 0,83 qui ne couvre que le bilan azoté), + le volume de séances — la musculation
 * pèse plus lourd que le cardio —, + un bonus d'objectif : en déficit les protéines
 * protègent le muscle (Helms et al. 2014), en prise de masse elles alimentent la
 * synthèse (Morton et al. 2018 : plateau vers 1,6 g/kg, intérêt possible jusqu'à 2,2).
 */
export function protRecommandeParKg(
  sportHeures: number,
  sportType: SportType,
  objectif: 'maintien' | 'perte' | 'muscle',
): number {
  const base = 1.2;
  const sport = Math.min(0.5, sportHeures * PROT_PER_SPORT_HOUR[sportType]);
  const bonus = objectif === 'perte' ? 0.4 : objectif === 'muscle' ? 0.3 : 0;
  const v = base + sport + bonus;
  return Math.round(Math.min(2.6, v) * 10) / 10;
}

export interface ProtAdvice {
  text: string;
  warn: boolean;
}

/** Commentaire sur la valeur de protéines choisie, par rapport au conseil calculé. */
export function protAdvice(parKg: number, conseil: number): ProtAdvice {
  const v = parKg.toLocaleString('fr-FR');
  if (parKg < 1) {
    return { warn: true, text: `${v} g/kg : sous le besoin d'une personne active. Risque de perte de muscle, surtout en déficit.` };
  }
  if (parKg < conseil - 0.25) {
    return { warn: false, text: `${v} g/kg : correct, mais en dessous du conseil calculé pour votre volume d'entraînement (${conseil.toLocaleString('fr-FR')} g/kg).` };
  }
  if (parKg <= conseil + 0.35) {
    return { warn: false, text: `${v} g/kg : dans la zone conseillée pour votre profil. Rien à ajouter.` };
  }
  if (parKg <= PROT_BOUNDS.safeMax) {
    return {
      warn: false,
      text: `${v} g/kg : au-dessus du nécessaire, mais sans danger connu chez un rein sain — et rassasiant. Le supplément n'apporte pas de muscle en plus.`,
    };
  }
  return {
    warn: true,
    text: `${v} g/kg : très haut. Aucun bénéfice démontré au-delà de ~2,2 g/kg, et cela prend la place des glucides qui alimentent les séances.`,
  };
}
