import { z } from 'zod';
import { UNITS, EMPTY_NUTRIENTS } from '../nutrition/types';
import type { ExtractedItem, Nutrients, NutrientKey } from '../nutrition/types';

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

/** Complète des nutriments partiels avec toutes les clés manquantes (à 0). */
function fullNutrients(partial: Partial<Record<NutrientKey, number>>): Nutrients {
  return { ...EMPTY_NUTRIENTS, ...partial };
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
    ...(it.nutriments ? { nutriments: fullNutrients(it.nutriments), categorie: it.categorie, grammesParPiece: it.grammesParPiece } : {}),
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
Exemple : {"aliment":"pastel de nata","quantite":1,"unite":"piece","estimation":true,"categorie":"sucre-snack","grammesParPiece":60,"nutriments":{"kcal":298,"proteines":6,"glucides":37,"lipides":13,"fibres":1,"agSatures":6,"agMonoInsatures":4,"agPolyInsatures":1.5,"omega3":0.1,"omega6":1.2,"omega9":3.5,"fer":0.6,"magnesium":12,"potassium":90,"calcium":80,"zinc":0.5,"sodium":180,"selenium":8,"iode":10,"vitA":90,"vitC":0,"vitD":0.8,"vitE":0.4,"vitK1":2,"vitK2":1,"vitB1":0.05,"vitB2":0.2,"vitB3":0.4,"vitB5":0.5,"vitB6":0.05,"vitB9":18,"vitB12":0.4,"creatine":0,"collagene":0}}
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
