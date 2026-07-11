import type { NutrientKey } from './types';

/**
 * Apports de référence quotidiens (adulte) — sources : NRV européens (règlement
 * UE 1169/2011), références nutritionnelles ANSES, et apports satisfaisants (AS)
 * pour les nutriments sans RDA officiel (potassium, oméga…).
 *
 * Chaque nutriment porte un OBJECTIF (`goal`) :
 *  - `atLeast` : à couvrir puis à viser haut (cible « optimale santé/sport »).
 *  - `limit`   : à garder le plus bas possible ; `rda` est un plafond, `optimalLow`
 *                la cible basse idéale (sodium, AG saturés).
 *
 * Créatine : pas d'AJR officiel ; cible indicative 3 g/j (synthèse endogène ~1 g/j incluse).
 */

export type Goal = 'atLeast' | 'limit';

export interface RdaEntry {
  key: NutrientKey;
  label: string;
  unit: 'kcal' | 'g' | 'mg' | 'µg';
  /** atLeast : plancher de référence. limit : plafond à ne pas dépasser. */
  rda: number;
  goal: Goal;
  /**
   * Facteur « optimal » (santé/sport) appliqué au rda — goal `atLeast` uniquement.
   * Réfléchi par nutriment : proche de 1 quand pousser au-dessus de l'AJR n'apporte
   * rien (voire nuit : fer, calcium, vit A, sélénium…), plus élevé quand l'apport
   * « performance » est nettement supérieur (vit C, vit D, oméga 3…). Défaut : 1.
   */
  optimalFactor?: number;
  /** goal `limit` : cible basse idéale (« le plus bas raisonnable »), sous le plafond. */
  optimalLow?: number;
  /** Rôle physiologique — ce que le nutriment fait dans le corps. */
  role: string;
  /** Justification de la cible optimale ou de la limite. */
  optimalNote?: string;
}

export const RDA: RdaEntry[] = [
  {
    key: 'kcal', label: 'Calories', unit: 'kcal', rda: 2200, goal: 'atLeast',
    role: 'Énergie totale disponible pour le métabolisme de base, l\'activité et la récupération.',
    optimalNote: 'Calculée à partir du poids et du niveau d\'activité (≈ 31 kcal/kg sédentaire → 45 kcal/kg intense).',
  },
  {
    key: 'proteines', label: 'Protéines', unit: 'g', rda: 60, goal: 'atLeast',
    role: 'Briques des muscles, enzymes et hormones ; réparation des tissus après l\'effort.',
    optimalNote: 'AJR = 0,83 g/kg. Optimal sportif 1,4 → 2,2 g/kg selon l\'activité pour soutenir la synthèse musculaire.',
  },
  {
    key: 'glucides', label: 'Glucides', unit: 'g', rda: 260, goal: 'atLeast', optimalFactor: 1,
    role: 'Carburant préférentiel des muscles et du cerveau ; recharge le glycogène.',
    optimalNote: 'Le besoin dépend du volume d\'entraînement ; l\'AJR couvre déjà une activité soutenue.',
  },
  {
    key: 'lipides', label: 'Lipides', unit: 'g', rda: 80, goal: 'atLeast', optimalFactor: 1,
    role: 'Réserve d\'énergie, hormones stéroïdiennes, absorption des vitamines A/D/E/K.',
    optimalNote: '≈ 30-35 % de l\'énergie. La qualité (voir oméga et rapports) prime sur la quantité.',
  },
  {
    key: 'fibres', label: 'Fibres', unit: 'g', rda: 30, goal: 'atLeast', optimalFactor: 1.2,
    role: 'Transit, satiété, contrôle glycémique et nourriture du microbiote intestinal.',
    optimalNote: 'AS ≈ 30 g ; viser ~36 g apporte un bénéfice cardiométabolique supplémentaire.',
  },
  {
    key: 'agSatures', label: 'AG saturés', unit: 'g', rda: 22, goal: 'limit', optimalLow: 15,
    role: 'Source d\'énergie, mais un excès élève le LDL-cholestérol et le risque cardiovasculaire.',
    optimalNote: 'Plafond ≈ 10 % de l\'énergie (≈ 22 g pour 2000 kcal) ; idéal le plus bas, vers 15 g.',
  },
  {
    key: 'agMonoInsatures', label: 'AG mono-insaturés', unit: 'g', rda: 35, goal: 'atLeast', optimalFactor: 1,
    role: 'Graisses « cœur-protectrices » (huile d\'olive, avocat) qui améliorent le profil lipidique.',
  },
  {
    key: 'agPolyInsatures', label: 'AG poly-insaturés', unit: 'g', rda: 15, goal: 'atLeast', optimalFactor: 1,
    role: 'Contiennent les acides gras essentiels oméga 3 et 6 ; membranes cellulaires, signalisation.',
  },
  {
    key: 'omega3', label: 'Oméga 3', unit: 'g', rda: 2, goal: 'atLeast', optimalFactor: 1.5,
    role: 'Anti-inflammatoire ; EPA/DHA soutiennent cœur, cerveau et récupération musculaire.',
    optimalNote: 'AS ALA ≈ 2 g. Optimal ~3 g avec EPA+DHA relevés (250-500 mg) pour l\'effet anti-inflammatoire.',
  },
  {
    key: 'omega6', label: 'Oméga 6', unit: 'g', rda: 10, goal: 'atLeast', optimalFactor: 1,
    role: 'Acide gras essentiel (acide linoléique) ; en excès relatif, favorise l\'inflammation.',
    optimalNote: 'Essentiel mais rarement en déficit. Ce qui compte est le rapport oméga-6/oméga-3 (voir Guide).',
  },
  {
    key: 'omega9', label: 'Oméga 9', unit: 'g', rda: 20, goal: 'atLeast', optimalFactor: 1,
    role: 'Acide oléique (non essentiel) ; contribue au bon profil lipidique.',
  },
  {
    key: 'fer', label: 'Fer', unit: 'mg', rda: 14, goal: 'atLeast', optimalFactor: 1,
    role: 'Transport de l\'oxygène (hémoglobine) et production d\'énergie ; clé pour l\'endurance.',
    optimalNote: 'Ne pas dépasser inutilement : le fer en excès est pro-oxydant. Besoin plus élevé chez la femme.',
  },
  {
    key: 'magnesium', label: 'Magnésium', unit: 'mg', rda: 375, goal: 'atLeast', optimalFactor: 1.15,
    role: '300+ réactions enzymatiques : contraction musculaire, production d\'énergie (ATP), sommeil.',
    optimalNote: 'Pertes accrues par la sueur : viser le haut de la fourchette (~430 mg) chez le sportif.',
  },
  {
    key: 'potassium', label: 'Potassium', unit: 'mg', rda: 3500, goal: 'atLeast', optimalFactor: 1.15,
    role: 'Équilibre hydrique, tension artérielle et transmission nerveuse/musculaire.',
    optimalNote: 'AS ≈ 3500 mg ; viser ~4000 mg soutient une tension basse. Le rapport avec le sodium compte (voir Guide).',
  },
  {
    key: 'calcium', label: 'Calcium', unit: 'mg', rda: 950, goal: 'atLeast', optimalFactor: 1,
    role: 'Minéralisation osseuse, contraction musculaire et coagulation.',
    optimalNote: 'Inutile de dépasser ~1000 mg ; l\'excès sans vitamine K2/D peut favoriser les calcifications.',
  },
  {
    key: 'zinc', label: 'Zinc', unit: 'mg', rda: 11, goal: 'atLeast', optimalFactor: 1.1,
    role: 'Immunité, synthèse protéique, testostérone et cicatrisation.',
    optimalNote: 'Pertes par la sueur chez le sportif ; ne pas dépasser durablement 25 mg (antagonise le cuivre).',
  },
  {
    key: 'sodium', label: 'Sodium', unit: 'mg', rda: 2000, goal: 'limit', optimalLow: 1500,
    role: 'Équilibre hydrique et influx nerveux, mais l\'excès élève la tension artérielle.',
    optimalNote: 'Plafond OMS ≈ 2000 mg (≈ 5 g de sel) ; idéal vers 1500 mg. Un peu plus toléré si transpiration abondante.',
  },
  {
    key: 'selenium', label: 'Sélénium', unit: 'µg', rda: 70, goal: 'atLeast', optimalFactor: 1,
    role: 'Antioxydant (glutathion peroxydase) et fonction thyroïdienne.',
    optimalNote: 'Fenêtre de sécurité étroite : rester proche de l\'AJR, éviter de dépasser ~300 µg.',
  },
  {
    key: 'iode', label: 'Iode', unit: 'µg', rda: 150, goal: 'atLeast', optimalFactor: 1,
    role: 'Synthèse des hormones thyroïdiennes, qui règlent le métabolisme.',
  },
  {
    key: 'vitA', label: 'Vitamine A', unit: 'µg', rda: 750, goal: 'atLeast', optimalFactor: 1,
    role: 'Vision, immunité et renouvellement de la peau et des muqueuses.',
    optimalNote: 'Vitamine liposoluble toxique en excès (rétinol) : ne pas pousser au-dessus de l\'AJR.',
  },
  {
    key: 'vitC', label: 'Vitamine C', unit: 'mg', rda: 110, goal: 'atLeast', optimalFactor: 2.7,
    role: 'Antioxydant, synthèse du collagène, absorption du fer et soutien immunitaire.',
    optimalNote: 'Hydrosoluble et sûre : cible sportive ~300 mg pour couvrir le stress oxydatif de l\'entraînement.',
  },
  {
    key: 'vitD', label: 'Vitamine D', unit: 'µg', rda: 15, goal: 'atLeast', optimalFactor: 3.3,
    role: 'Absorption du calcium, santé osseuse, immunité et fonction musculaire.',
    optimalNote: 'Déficit très fréquent : cible ~50 µg (2000 UI/j), sous le plafond de 100 µg.',
  },
  {
    key: 'vitE', label: 'Vitamine E', unit: 'mg', rda: 12, goal: 'atLeast', optimalFactor: 1.2,
    role: 'Antioxydant liposoluble protégeant les membranes cellulaires.',
  },
  {
    key: 'vitK1', label: 'Vitamine K1', unit: 'µg', rda: 79, goal: 'atLeast', optimalFactor: 1,
    role: 'Coagulation sanguine (phylloquinone des légumes verts).',
  },
  {
    key: 'vitK2', label: 'Vitamine K2', unit: 'µg', rda: 100, goal: 'atLeast', optimalFactor: 1,
    role: 'Dirige le calcium vers les os plutôt que les artères (ménaquinones MK-4/MK-7).',
    optimalNote: 'Agit en synergie avec la vitamine D et le calcium pour la santé osseuse et artérielle.',
  },
  {
    key: 'vitB1', label: 'Vitamine B1', unit: 'mg', rda: 1.1, goal: 'atLeast', optimalFactor: 1.2,
    role: 'Thiamine : métabolisme des glucides et fonction nerveuse.',
  },
  {
    key: 'vitB2', label: 'Vitamine B2', unit: 'mg', rda: 1.4, goal: 'atLeast', optimalFactor: 1.2,
    role: 'Riboflavine : production d\'énergie cellulaire et régénération des antioxydants.',
  },
  {
    key: 'vitB3', label: 'Vitamine B3 (PP)', unit: 'mg', rda: 16, goal: 'atLeast', optimalFactor: 1.1,
    role: 'Niacine : métabolisme énergétique et réparation de l\'ADN.',
  },
  {
    key: 'vitB5', label: 'Vitamine B5', unit: 'mg', rda: 6, goal: 'atLeast', optimalFactor: 1.1,
    role: 'Acide pantothénique : synthèse du coenzyme A, central dans le métabolisme.',
  },
  {
    key: 'vitB6', label: 'Vitamine B6', unit: 'mg', rda: 1.4, goal: 'atLeast', optimalFactor: 1.2,
    role: 'Métabolisme des protéines et des acides aminés, synthèse des neurotransmetteurs.',
  },
  {
    key: 'vitB9', label: 'Vitamine B9', unit: 'µg', rda: 330, goal: 'atLeast', optimalFactor: 1.1,
    role: 'Folates : synthèse de l\'ADN et division cellulaire ; crucial en cas de grossesse.',
  },
  {
    key: 'vitB12', label: 'Vitamine B12', unit: 'µg', rda: 4, goal: 'atLeast', optimalFactor: 1.1,
    role: 'Formation des globules rouges, système nerveux et métabolisme de l\'homocystéine.',
    optimalNote: 'Présente presque uniquement dans les produits animaux : à surveiller en régime végétal.',
  },
  {
    key: 'creatine', label: 'Créatine', unit: 'g', rda: 3, goal: 'atLeast', optimalFactor: 1,
    role: 'Recharge rapide de l\'ATP : force, puissance et performances sur efforts brefs.',
    optimalNote: 'Pas d\'AJR officiel. ~3 g/j (synthèse ~1 g + apport) ; supplémenter jusqu\'à 3-5 g est courant et sûr.',
  },
];
