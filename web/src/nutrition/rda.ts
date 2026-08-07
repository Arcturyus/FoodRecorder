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
  /**
   * Poids d'IMPORTANCE par défaut du nutriment dans les recommandations et les
   * conseils du jour (multiplie le poids d'un manque/excès). Défaut : 1. Plus bas
   * pour les nutriments optionnels (créatine, collagène — surtout via complément),
   * plus haut pour les manques fréquents et graves (oméga 3, vitamine D).
   * Surchargeable par l'utilisateur (cf. `nutrientImportance` du store).
   */
  importance?: number;
  /** goal `limit` : cible basse idéale (« le plus bas raisonnable »), sous le plafond. */
  optimalLow?: number;
  /**
   * Seuil de PRUDENCE haut, dans l'unité du nutriment : au-delà, l'excès n'est
   * plus anodin. C'est la limite supérieure de sécurité officielle quand elle
   * existe et qu'elle porte sur l'apport TOTAL (EFSA, à défaut IOM) ; sinon un
   * repère assumé, toujours justifié dans le texte du guide (`NUTRIENT_GUIDE`).
   * Absent = aucun excès connu par l'alimentation (vitamines B1, B2, B5, B12,
   * K1, K2…) : ces nutriments n'ont alors PAS de barre d'excès, plutôt qu'une
   * limite inventée pour faire joli.
   */
  upper?: number;
  /**
   * Dose à laquelle des effets délétères ont réellement été OBSERVÉS chez
   * l'humain — presque toujours bien au-dessus de `upper`, qui garde une marge.
   * Sert de fin d'échelle à la barre d'excès : entre les deux, on est dans la
   * zone « à ne pas y rester », pas dans la zone « danger ».
   */
  toxic?: number;
  /**
   * Sous-détail d'un autre nutriment (ex. C16+C14 ⊂ AG saturés). Il garde une
   * cible propre — donc il compte dans le score et les recommandations — mais
   * n'a PAS sa tuile dans le bilan du jour : il s'affiche sous celle du parent,
   * qui resterait sinon un fourre-tout illisible.
   */
  parent?: NutrientKey;
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
    key: 'fibres', label: 'Fibres', unit: 'g', rda: 30, goal: 'atLeast', optimalFactor: 1.2, upper: 60,
    role: 'Transit, satiété, contrôle glycémique et nourriture du microbiote intestinal.',
    optimalNote: 'AS ≈ 30 g ; viser ~36 g apporte un bénéfice cardiométabolique supplémentaire.',
  },
  {
    key: 'agSatures', label: 'AG saturés', unit: 'g', rda: 30, goal: 'limit', optimalLow: 20, importance: 0.5,
    role: 'Total des acides gras saturés — un fourre-tout : c\'est le palmitique et le myristique qui élèvent le LDL, pas le stéarique.',
    optimalNote: 'Devenu un FILET DE SÉCURITÉ (plafond 30 g, idéal ≤ 20 g), avec un poids réduit : le vrai plafond porte sur les deux sous-détails ci-dessous, pour ne pas pénaliser deux fois le même excès. Le total sert surtout à couvrir la part non détaillée (laurique C12, chaînes courtes des laitages). Voir « AG saturés : tous ne se valent pas » dans Nutriments.',
  },
  {
    key: 'agSaturesLdl', parent: 'agSatures',
    label: 'AG saturés à limiter (C16+C14)', unit: 'g', rda: 15, goal: 'limit', optimalLow: 10, importance: 1.2,
    role: 'Palmitique et myristique : beurre, crème, fromage, viande grasse, huile de palme. Ils freinent l\'élimination du LDL par le foie — en excès, LDL en hausse et plaques artérielles à long terme.',
    optimalNote: 'C\'est LE plafond qui compte, et c\'est une VRAIE limite, pas un prorata de l\'ancienne : le « moins de 10 % de l\'énergie » des recommandations vise les saturés qui élèvent le LDL, et l\'American Heart Association descend à 7 % pour la prévention cardiovasculaire — soit ≈ 15 g pour 2000 kcal, idéal ≤ 10 g. Lue ainsi, elle est plus exigeante que l\'ancien plafond de 22 g sur le total, puisque le stéarique n\'y est plus compté.',
  },
  {
    key: 'agSaturesStearique', parent: 'agSatures',
    label: 'Stéarique C18 (AG saturé neutre)', unit: 'g', rda: 18, goal: 'limit', optimalLow: 12, importance: 0.5,
    role: 'Chocolat noir (le beurre de cacao en est ~1/3), bœuf et agneau. Le foie le désature vite en acide oléique — celui de l\'huile d\'olive : il ne fait pas monter le LDL.',
    optimalNote: 'Repère HAUT et volontairement souple (18 g/j, idéal ≤ 12 g), poids d\'importance faible : les études en milieu contrôlé en ont fait manger jusqu\'à ~11 % de l\'énergie (≈ 24 g/j) sans voir bouger le LDL, et un apport courant est de 5-8 g. Il n\'est pas laissé totalement libre car il fait un peu baisser le HDL, il est soupçonné de favoriser l\'agrégation plaquettaire, et il n\'arrive presque jamais seul (le palmitique l\'accompagne).',
  },
  {
    key: 'agTrans', label: 'AG trans', unit: 'g', rda: 2, goal: 'limit', optimalLow: 0, toxic: 4,
    role: 'Graisses industrielles (huiles partiellement hydrogénées, fritures, viennoiseries) ; trace naturelle chez les ruminants (bœuf, agneau, produits laitiers).',
    optimalNote: 'OMS : ne pas dépasser 1 % de l\'énergie (≈ 2 g/2000 kcal). Contrairement aux AG saturés, aucun seuil n\'est considéré sûr : viser 0.',
  },
  {
    key: 'agMonoInsatures', label: 'AG mono-insaturés', unit: 'g', rda: 35, goal: 'atLeast', optimalFactor: 1,
    role: 'Graisses « cœur-protectrices » (huile d\'olive, avocat) qui améliorent le profil lipidique.',
  },
  {
    key: 'agPolyInsatures', label: 'AG poly-insaturés', unit: 'g', rda: 15, goal: 'atLeast', optimalFactor: 1, upper: 24,
    role: 'Contiennent les acides gras essentiels oméga 3 et 6 ; membranes cellulaires, signalisation.',
  },
  {
    key: 'omega3', label: 'Oméga 3', unit: 'g', rda: 1, goal: 'atLeast', optimalFactor: 2, importance: 1.5, upper: 5,
    role: 'Anti-inflammatoire ; EPA/DHA soutiennent cœur, cerveau et récupération musculaire.',
    optimalNote: 'Équivalent pondéré = ALA ÷ 10 + EPA + DHA (l\'ALA végétal est mal converti par le corps, ~10 % de rendement) ; c\'est cette valeur qui compte pour la cible, les rapports et le score. Plancher 1 g, optimal 2 g d\'équivalent : l\'essentiel doit venir de l\'EPA/DHA direct (l\'ALA, même à ~2 g, ne pèse que ~0,2 g éq.). ~2 portions de poisson gras/semaine ≈ 250-500 mg/j d\'EPA+DHA ; pour viser l\'optimal sans poisson quotidien, appoint d\'huile de poisson/algue.',
  },
  {
    key: 'omega6', label: 'Oméga 6', unit: 'g', rda: 10, goal: 'atLeast', optimalFactor: 1,
    role: 'Acide gras essentiel (acide linoléique) ; en excès relatif, favorise l\'inflammation.',
    optimalNote: 'Essentiel mais rarement en déficit. Ce qui compte est le rapport oméga-6/oméga-3 (voir Nutriments).',
  },
  {
    key: 'omega9', label: 'Oméga 9', unit: 'g', rda: 20, goal: 'atLeast', optimalFactor: 1,
    role: 'Acide oléique (non essentiel) ; contribue au bon profil lipidique.',
  },
  {
    key: 'fer', label: 'Fer', unit: 'mg', rda: 9, goal: 'atLeast', optimalFactor: 1, upper: 45, toxic: 60,
    role: 'Transport de l\'oxygène (hémoglobine) et production d\'énergie ; clé pour l\'endurance.',
    optimalNote: 'Homme : 9 mg, les pertes sont faibles. Femme : 15-18 mg si les règles sont là, sinon comme l\'homme ; 27 mg enceinte. En excès le fer est pro-oxydant (détail dans le Guide).',
  },
  {
    // upper 700 : l'EFSA ne limite que le magnésium AJOUTÉ (250 mg de sels en
    // supplément) — l'alimentaire n'a pas de plafond. 700 ≈ apport courant élevé
    // + une dose de complément : au-delà, c'est forcément de la supplémentation.
    key: 'magnesium', label: 'Magnésium', unit: 'mg', rda: 375, goal: 'atLeast', optimalFactor: 1.15, upper: 700,
    role: '300+ réactions enzymatiques : contraction musculaire, production d\'énergie (ATP), sommeil.',
    optimalNote: 'Pertes accrues par la sueur : viser le haut de la fourchette (~430 mg) chez le sportif.',
  },
  {
    key: 'potassium', label: 'Potassium', unit: 'mg', rda: 3500, goal: 'atLeast', optimalFactor: 1.15, upper: 6000,
    role: 'Équilibre hydrique, tension artérielle et transmission nerveuse/musculaire.',
    optimalNote: 'AS ≈ 3500 mg ; viser ~4000 mg soutient une tension basse. Le rapport avec le sodium compte (voir Nutriments).',
  },
  {
    key: 'calcium', label: 'Calcium', unit: 'mg', rda: 950, goal: 'atLeast', optimalFactor: 1, upper: 2500, toxic: 4000,
    role: 'Minéralisation osseuse, contraction musculaire et coagulation.',
    optimalNote: 'Inutile de dépasser ~1000 mg ; l\'excès sans vitamine K2/D peut favoriser les calcifications.',
  },
  {
    key: 'zinc', label: 'Zinc', unit: 'mg', rda: 11, goal: 'atLeast', optimalFactor: 1.1, upper: 25, toxic: 50,
    role: 'Immunité, synthèse protéique, testostérone et cicatrisation.',
    optimalNote: 'Pertes par la sueur chez le sportif ; ne pas dépasser durablement 25 mg (antagonise le cuivre).',
  },
  {
    // Plafond relevé de 2000 à 3000 mg : l'objectif OMS est le plus contesté de
    // toutes les recommandations (courbe en J de PURE, cf. le guide). 3000 mg est
    // le bas de la zone où les cohortes ne voient plus de sur-risque ; l'ancien
    // plafond OMS devient la cible basse idéale.
    key: 'sodium', label: 'Sodium', unit: 'mg', rda: 3000, goal: 'limit', optimalLow: 2000, toxic: 5000,
    role: 'Équilibre hydrique et influx nerveux, mais l\'excès élève la tension artérielle.',
    optimalNote: 'Plafond retenu 3000 mg (≈ 7,5 g de sel), idéal vers 2000 mg — au-dessus de l\'objectif OMS (2000 mg), qui est le seuil le plus discuté de la nutrition. Un peu plus toléré si transpiration abondante.',
  },
  {
    key: 'selenium', label: 'Sélénium', unit: 'µg', rda: 70, goal: 'atLeast', optimalFactor: 1, upper: 300, toxic: 900,
    role: 'Antioxydant (glutathion peroxydase) et fonction thyroïdienne.',
    optimalNote: 'Fenêtre de sécurité étroite : rester proche de l\'AJR, éviter de dépasser ~300 µg.',
  },
  {
    key: 'iode', label: 'Iode', unit: 'µg', rda: 150, goal: 'atLeast', optimalFactor: 1, upper: 600, toxic: 1100,
    role: 'Synthèse des hormones thyroïdiennes, qui règlent le métabolisme.',
  },
  {
    key: 'vitA', label: 'Vitamine A', unit: 'µg', rda: 750, goal: 'atLeast', optimalFactor: 1, upper: 3000, toxic: 7500,
    role: 'Vision, immunité et renouvellement de la peau et des muqueuses.',
    optimalNote: 'Vitamine liposoluble toxique en excès (rétinol) : ne pas pousser au-dessus de l\'AJR.',
  },
  {
    key: 'vitC', label: 'Vitamine C', unit: 'mg', rda: 110, goal: 'atLeast', optimalFactor: 2.7, upper: 2000, toxic: 3000,
    role: 'Antioxydant, synthèse du collagène, absorption du fer et soutien immunitaire.',
    optimalNote: 'Hydrosoluble et sûre : cible sportive ~300 mg pour couvrir le stress oxydatif de l\'entraînement.',
  },
  {
    key: 'vitD', label: 'Vitamine D', unit: 'µg', rda: 15, goal: 'atLeast', optimalFactor: 3.3, importance: 1.3, upper: 100, toxic: 250,
    role: 'Absorption du calcium, santé osseuse, immunité et fonction musculaire.',
    optimalNote: 'Déficit très fréquent : cible ~50 µg (2000 UI/j), sous le plafond de 100 µg.',
  },
  {
    key: 'vitE', label: 'Vitamine E', unit: 'mg', rda: 12, goal: 'atLeast', optimalFactor: 1.2, upper: 300, toxic: 1000,
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
    // upper 900 = limite du nicotinamide (forme alimentaire dominante) ; l'acide
    // nicotinique en supplément, lui, fait rougir dès 30-50 mg (cf. le guide).
    key: 'vitB3', label: 'Vitamine B3 (PP)', unit: 'mg', rda: 16, goal: 'atLeast', optimalFactor: 1.1, upper: 900, toxic: 2000,
    role: 'Niacine : métabolisme énergétique et réparation de l\'ADN.',
  },
  {
    key: 'vitB5', label: 'Vitamine B5', unit: 'mg', rda: 6, goal: 'atLeast', optimalFactor: 1.1,
    role: 'Acide pantothénique : synthèse du coenzyme A, central dans le métabolisme.',
  },
  {
    key: 'vitB6', label: 'Vitamine B6', unit: 'mg', rda: 1.4, goal: 'atLeast', optimalFactor: 1.2, upper: 12, toxic: 50,
    role: 'Métabolisme des protéines et des acides aminés, synthèse des neurotransmetteurs.',
  },
  {
    key: 'vitB9', label: 'Vitamine B9', unit: 'µg', rda: 330, goal: 'atLeast', optimalFactor: 1.1, upper: 1000,
    role: 'Folates : synthèse de l\'ADN et division cellulaire ; crucial en cas de grossesse.',
  },
  {
    key: 'vitB12', label: 'Vitamine B12', unit: 'µg', rda: 4, goal: 'atLeast', optimalFactor: 1.1,
    role: 'Formation des globules rouges, système nerveux et métabolisme de l\'homocystéine.',
    optimalNote: 'Présente presque uniquement dans les produits animaux : à surveiller en régime végétal.',
  },
  {
    key: 'creatine', label: 'Créatine', unit: 'g', rda: 3, goal: 'atLeast', optimalFactor: 1, importance: 0.4,
    role: 'Recharge rapide de l\'ATP : force, puissance et performances sur efforts brefs.',
    optimalNote: 'Pas d\'AJR officiel. ~3 g/j (synthèse ~1 g + apport) ; supplémenter jusqu\'à 3-5 g est courant et sûr.',
  },
  {
    key: 'collagene', label: 'Collagène', unit: 'g', rda: 10, goal: 'atLeast', optimalFactor: 1, importance: 0.6,
    role: 'Protéine structurale de la peau, des tendons, du cartilage et des os ; soutient les articulations.',
    optimalNote: 'Pas d\'AJR officiel : repère issu des études (~10 g/j de peptides). Sous-ensemble des protéines, présent uniquement dans les tissus conjonctifs animaux (peau, tendons, os, morceaux gélatineux) — nul dans les végétaux, les laitages et les œufs.',
  },
];
