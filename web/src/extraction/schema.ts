import { z } from 'zod';
import { UNITS, EMPTY_NUTRIENTS } from '../nutrition/types';
import type { ExtractedItem, FoodCategory, Nutrients, NutrientKey } from '../nutrition/types';
import { splitSaturated } from '../nutrition/foods';

/** Toutes les clés de nutriments (ordre stable, pour prompts + validation). */
const NUTRIENT_KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

/** Catégories acceptées pour un aliment estimé par l'IA. */
const CATEGORIES = [
  'fruit', 'legume', 'feculent', 'viande', 'poisson', 'oeuf-laitier',
  'sucre-snack', 'matiere-grasse', 'boisson', 'plat', 'supplement', 'autre',
] as const;

/**
 * Nutriments estimés par l'IA (pour 100 g). Chaque clé est tolérée absente
 * (l'IA peut en oublier), puis complétée à 0 lors de la normalisation — mais le
 * prompt demande de TOUT renseigner.
 */
const nutrimentsSchema = z.object(
  Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, z.number().nonnegative().optional()])),
) as z.ZodType<Partial<Record<NutrientKey, number>>>;

export const extractedItemSchema = z.object({
  aliment: z.string().min(1),
  quantite: z.number().positive(),
  unite: z.enum(UNITS),
  estimation: z.boolean(),
  // Fourchette plausible de quantité (même unité), quand l'IA estime.
  quantiteMin: z.number().positive().optional(),
  quantiteMax: z.number().positive().optional(),
  // Champs réservés à l'estimation IA d'un aliment hors base (optionnels).
  nutriments: nutrimentsSchema.optional(),
  categorie: z.enum(CATEGORIES).optional(),
  grammesParPiece: z.number().positive().optional(),
});

export const extractionSchema = z.object({
  items: z.array(extractedItemSchema),
});

export type Extraction = z.infer<typeof extractionSchema>;

/** JSON Schema équivalent, pour le décodage contraint de WebLLM (IA locale, sans estimation). */
export const extractionJsonSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          aliment: { type: 'string' },
          quantite: { type: 'number' },
          unite: { type: 'string', enum: [...UNITS] },
          estimation: { type: 'boolean' },
        },
        required: ['aliment', 'quantite', 'unite', 'estimation'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

/**
 * Complète des nutriments partiels avec toutes les clés manquantes (à 0).
 *
 * Cas particulier des AG saturés : si l'IA a donné le total sans la répartition
 * C16+C14 / C18 (modèle plus ancien, oubli), on l'estime depuis la catégorie —
 * une répartition vide ferait mentir la ligne « dont » du bilan et sortirait
 * l'aliment du plafond qui compte.
 */
function fullNutrients(partial: Partial<Record<NutrientKey, number>>, categorie?: FoodCategory): Nutrients {
  const n = { ...EMPTY_NUTRIENTS, ...partial };
  if (n.agSatures > 0 && n.agSaturesLdl === 0 && n.agSaturesStearique === 0) {
    Object.assign(n, splitSaturated(n.agSatures, categorie ?? 'autre'));
  }
  return n;
}

export function validateExtraction(raw: unknown): ExtractedItem[] | null {
  const parsed = extractionSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.items.map((it) => ({
    aliment: it.aliment,
    quantite: it.quantite,
    unite: it.unite,
    estimation: it.estimation,
    // Fourchette conservée seulement si cohérente (min < max et quantité dedans).
    ...(it.quantiteMin != null &&
    it.quantiteMax != null &&
    it.quantiteMin < it.quantiteMax &&
    it.quantiteMin <= it.quantite &&
    it.quantite <= it.quantiteMax
      ? { quantiteMin: it.quantiteMin, quantiteMax: it.quantiteMax }
      : {}),
    // On ne conserve l'estimation IA que si des nutriments ont été fournis.
    ...(it.nutriments
      ? { nutriments: fullNutrients(it.nutriments, it.categorie), categorie: it.categorie, grammesParPiece: it.grammesParPiece }
      : {}),
  }));
}

/**
 * Documentation des champs nutritionnels (avec unités) à injecter dans le prompt
 * des IA fortes pour l'estimation d'un aliment hors base.
 */
export const NUTRIMENTS_PROMPT_DOC = `Toutes les valeurs sont POUR 100 g d'aliment. Unités :
- kcal : énergie en kcal
- proteines, glucides, lipides, fibres : g
- agSatures, agMonoInsatures, agPolyInsatures, omega3, omega6, omega9 : g (omega3/6 ⊂ poly-insaturés, omega9 ⊂ mono-insaturés)
- agSaturesLdl, agSaturesStearique : g — RÉPARTITION des AG saturés (sous-ensembles de agSatures, à renseigner dès que agSatures > 0).
  · agSaturesLdl = palmitique C16:0 + myristique C14:0, ceux qui élèvent le LDL (beurre, crème, fromage, viande grasse, huile de palme).
  · agSaturesStearique = stéarique C18:0, neutre sur le LDL (beurre de cacao donc chocolat noir, bœuf, agneau).
  · Leur somme est ≤ agSatures ; le reste (laurique C12, chaînes courtes des laitages, C20/C22 des oléagineux) n'est pas détaillé.
  · Ordres de grandeur, en part des AG saturés : matière grasse laitière ≈ 62 % / 18 % ; beurre de cacao ≈ 43 % / 56 % ; huile de palme ≈ 90 % / 8 % ; bœuf ≈ 66 % / 34 % ; agneau ≈ 54 % / 42 % ; volaille ≈ 76 % / 20 % ; poisson ≈ 78 % / 16 % ; végétal courant ≈ 85 % / 8 %.
- fer, magnesium, potassium, calcium, zinc, sodium : mg
- vitC, vitE, vitB1, vitB2, vitB3, vitB5, vitB6 : mg
- selenium, iode, vitA, vitD, vitK1, vitK2, vitB9, vitB12 : µg (vitA en µg équivalent rétinol)
- creatine : g (viandes/poissons, 0 sinon)
- collagene : g (sous-ensemble des proteines : tissus conjonctifs animaux — peau, tendons, os, morceaux gélatineux, gélatine. 0 pour tout végétal, laitage ou œuf)`;

/**
 * Consigne d'estimation d'un aliment hors base, commune aux IA fortes (API Claude
 * et pont Claude Code). L'IA ne connaît pas le contenu de la base : elle n'estime
 * que pour les aliments spécifiques/inhabituels peu susceptibles d'y figurer.
 */
export const ESTIMATION_PROMPT = `Aliment hors base — ESTIMATION AUTORISÉE (IA forte uniquement) :
L'application dispose d'une base d'aliments courants (fruits, légumes, viandes, féculents, produits laitiers génériques…), qu'elle résout elle-même : pour ces aliments, ne renseigne PAS de nutriments.
En revanche, pour un aliment SPÉCIFIQUE, composé, régional, exotique ou de marque, peu susceptible de figurer dans une base générique (ex. « pastel de nata », « poke bowl saumon avocat », « barre protéinée », « tajine d'agneau »), tu PEUX l'ajouter avec une estimation nutritionnelle complète.
Dans ce cas, ajoute à l'item :
- "categorie" ∈ ["fruit","legume","feculent","viande","poisson","oeuf-laitier","sucre-snack","matiere-grasse","boisson","plat","supplement","autre"]
- "grammesParPiece" (optionnel) : poids en g d'une pièce/portion si l'unité est "piece"/"portion"
- "nutriments" : un objet contenant TOUS les champs ci-dessous (n'en omets AUCUN ; mets 0 si négligeable).
${NUTRIMENTS_PROMPT_DOC}
Exemple : {"aliment":"pastel de nata","quantite":1,"unite":"piece","estimation":true,"categorie":"sucre-snack","grammesParPiece":60,"nutriments":{"kcal":298,"proteines":6,"glucides":37,"lipides":13,"fibres":1,"agSatures":6,"agSaturesLdl":3.9,"agSaturesStearique":1.1,"agMonoInsatures":4,"agPolyInsatures":1.5,"omega3":0.1,"omega6":1.2,"omega9":3.5,"fer":0.6,"magnesium":12,"potassium":90,"calcium":80,"zinc":0.5,"sodium":180,"selenium":8,"iode":10,"vitA":90,"vitC":0,"vitD":0.8,"vitE":0.4,"vitK1":2,"vitK2":1,"vitB1":0.05,"vitB2":0.2,"vitB3":0.4,"vitB5":0.5,"vitB6":0.05,"vitB9":18,"vitB12":0.4,"creatine":0,"collagene":0}}
N'utilise "nutriments" QUE lorsque c'est justifié ; en cas de doute, laisse l'application résoudre l'aliment (n'ajoute pas de nutriments).`;

/**
 * Consigne de CHOIX D'UNITÉ, commune à tous les moteurs.
 *
 * Les unités « contenant » (bol, assiette, portion…) existent pour les cas où
 * l'utilisateur parle vraiment comme ça, mais un LLM les choisit trop souvent
 * (« 1 portion de poulet ») là où il connaît parfaitement l'ordre de grandeur en
 * grammes. Or une portion générique vaut 150 g pour TOUT aliment (cf.
 * DEFAULT_UNIT_GRAMS) faute de surcharge : l'estimation en grammes du modèle est
 * presque toujours meilleure que ce forfait.
 */
export const UNITES_PROMPT = `Choix de l'unité — PRIVILÉGIE LES GRAMMES :
- Par défaut, exprime toujours la quantité en "g" (ou "ml" pour un liquide), quitte à convertir toi-même une mesure approximative : tu connais mieux le poids réel d'une portion que l'application, qui applique sinon un forfait générique identique pour tous les aliments.
- Convertis donc les contenants et les mesures de cuisine en grammes : « un bol de riz » → 200 g, « une assiette de pâtes » → 280 g, « une cuillère à soupe d'huile d'olive » → 14 g, « une poignée d'amandes » → 30 g, « un verre de lait » → 200 ml.
- Pour un COMPLÉMENT dosé en élément pur (magnésium, zinc, vitamine C, vitamine D…), utilise l'unité de l'étiquette : "mg" pour les minéraux et la plupart des vitamines, "µg" pour les micro-dosés (vitamine D, B12, K2, sélénium, iode). Ex. « 300 mg de magnésium » → {"quantite":300,"unite":"mg"}.
- N'utilise "piece" que pour un objet réellement dénombrable et standard (un œuf, une banane, un yaourt, un carré de chocolat).
- Ne garde une unité "portion", "bol", "assiette", "poignee", "cas", "cac", "verre", "tranche", "pot", "pincee" ou "dose" QUE si tu es incapable d'estimer un poids (cas rare) : c'est un dernier recours, pas le choix par défaut.`;

/**
 * Consigne de fourchette d'incertitude sur les quantités estimées, commune aux
 * IA fortes. Sert au calcul d'incertitude des totaux (± kcal du jour).
 */
export const FOURCHETTE_PROMPT = `Fourchette d'incertitude (optionnelle) : quand tu ESTIMES une quantité ("estimation": true), ajoute à l'item "quantiteMin" et "quantiteMax" (nombres, MÊME unité que "quantite") encadrant la fourchette plausible, quantiteMin < quantite < quantiteMax.
Exemple : une assiette de riz estimée à 180 g → {"quantite":180,"unite":"g","estimation":true,"quantiteMin":120,"quantiteMax":250}.
Sois honnête sur la largeur : étroite si le contexte est précis (« un yaourt » en pot standard), large si tu devines (volume vu de dessus sur une photo). Ne renseigne PAS ces champs quand la quantité est donnée explicitement par l'utilisateur.`;

/**
 * Consigne de DÉCOMPOSITION d'un assemblage d'aliments distincts en items
 * séparés, commune aux IA fortes (texte et photo). Complète — sans la
 * contredire — la règle « plat composé = un seul item » : le critère est la
 * SÉPARABILITÉ des composants (une salade de crudités se pèse ingrédient par
 * ingrédient ; un gâteau, non).
 */
export const DECOMPOSITION_PROMPT = `Décomposition d'un assemblage d'aliments distincts :
Quand le repas est un ASSEMBLAGE d'aliments entiers reconnaissables et quantifiables séparément (salade composée, assiette mixte, mélange de légumes, salade de fruits, plateau de crudités, bowl…), émets UN ITEM DISTINCT PAR aliment, chacun avec sa propre quantité — n'en fais pas un unique item « salade » ou « assiette ».
À NE PAS confondre avec le PLAT TRANSFORMÉ dont les ingrédients sont cuits/liés et non séparables (gâteau, tajine, quiche, soupe mixée, sauce, curry) : celui-là reste UN SEUL item estimé (cf. règle du plat composé). Critère : si chaque composant reste visible et pourrait être pesé à part, DÉCOMPOSE ; s'il forme une préparation homogène, garde un seul item.
Si les quantités par composant ne sont pas précisées, estime une part plausible pour chacun ("estimation": true).
Exemple : "une salade de tomates, poivrons et oignons"
→ {"items":[{"aliment":"tomate","quantite":100,"unite":"g","estimation":true,"quantiteMin":60,"quantiteMax":150},{"aliment":"poivron","quantite":80,"unite":"g","estimation":true,"quantiteMin":50,"quantiteMax":120},{"aliment":"oignon","quantite":40,"unite":"g","estimation":true,"quantiteMin":20,"quantiteMax":70}]}`;

/**
 * Consigne de PART COMESTIBLE (poids brut → poids réellement mangé), commune aux
 * IA fortes. L'utilisateur donne souvent le poids de ce qu'il a acheté ou sorti
 * du frigo (cuisse de poulet avec l'os, crevettes non décortiquées), alors que
 * seul ce qui est avalé compte au bilan : sans déduction, un poids brut gonfle
 * mécaniquement les apports.
 *
 * La règle est volontairement conservatrice : on ne retire QUE l'immangeable.
 * Ce qui se mange couramment (peau du poulet, peau du saumon, peau des fruits)
 * est conservé ; quand c'est vraiment discutable, on émet deux items séparés
 * pour que l'utilisateur supprime lui-même celui qu'il n'a pas mangé.
 */
export const PARTIE_COMESTIBLE_PROMPT = `Poids brut → part réellement MANGÉE :
Un poids annoncé ou vu sur une photo est souvent le poids BRUT, parties immangeables comprises. Compte alors la seule partie mangée, pas le poids total, avec "estimation": true et une fourchette "quantiteMin"/"quantiteMax" (le rendement est une estimation, même quand le poids brut, lui, était précis). Nomme l'aliment de façon parlante pour que l'utilisateur voie ce qui a été compté (« cuisse de poulet, chair et peau », « crevettes décortiquées »).
Retire ce qui finit dans l'assiette vide : os, arêtes, carapaces, coquilles, noyaux, pépins, trognons, épluchures réellement épluchées, couenne et gras taillé au couteau, feuilles extérieures, tiges dures, sachet de thé, jus de conserve égoutté.
NE retire PAS ce qui se mange couramment — dans le doute, on garde : la PEAU DU POULET (elle se mange : « cuisse de poulet » = chair + peau), la peau du saumon, la peau d'une pomme, d'une poire ou d'une pêche, le gras persillé d'une viande, la croûte d'un fromage, le pain d'un sandwich.
Rendements usuels (part comestible du poids brut) : cuisse de poulet avec os ≈ 70 % (chair + peau), pilon ≈ 65 %, aile ≈ 55 %, poulet entier ≈ 60 %, côte de porc ou d'agneau avec os ≈ 75 %, côte de bœuf ≈ 70 %, poisson entier ≈ 50 %, darne ou pavé avec arête ≈ 85 %, moules avec coquilles ≈ 30 %, crevettes entières ≈ 55 %, œuf en coquille ≈ 88 %, noix en coque ≈ 45 %, avocat ≈ 70 %, mangue ≈ 65 %, orange ou pamplemousse ≈ 70 %, banane ≈ 65 %, melon ou pastèque ≈ 55 %, ananas ≈ 55 %.
Part DISCUTABLE (typiquement la peau du poulet ou du poisson, mangée par les uns, laissée par les autres) : émets DEUX items séparés — la chair d'un côté, la peau de l'autre, chacun avec sa quantité — plutôt qu'un seul item global. L'utilisateur supprimera d'un geste celui qu'il n'a pas mangé, ce qu'un item unique ne permet pas.
Quand le poids donné est DÉJÀ net (« 200 g de blanc de poulet », « 150 g de filet de cabillaud », une portion pesée dans l'assiette, un plat servi), ne déduis RIEN et garde "estimation": false : c'est la part mangée.
Exemple : "j'ai mangé une cuisse de poulet de 250 grammes"
Raisonnement : 250 g est le poids avec l'os → chair + peau ≈ 70 % ≈ 175 g, dont ≈ 25 g de peau ; la peau se mange mais reste discutable → deux items.
Sortie : {"items":[{"aliment":"cuisse de poulet, chair sans peau","quantite":150,"unite":"g","estimation":true,"quantiteMin":130,"quantiteMax":170},{"aliment":"peau de poulet","quantite":25,"unite":"g","estimation":true,"quantiteMin":15,"quantiteMax":35}]}`;
