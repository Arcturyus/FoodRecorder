import type { NutrientKey } from './types';
import { EMPTY_NUTRIENTS } from './types';

/**
 * Regroupement des nutriments par famille, source de vérité UNIQUE partagée par le
 * sélecteur de tendance (Stats) et le panneau d'importance (Recommandations). Le
 * groupe « Autres » est CALCULÉ : tout nutriment absent des groupes nommés y tombe
 * automatiquement — un nouveau nutriment (créatine hier, collagène aujourd'hui)
 * apparaît ainsi sans qu'on ait à penser à cette liste.
 */
export const NUTRIENT_NAMED_GROUPS: { title: string; keys: NutrientKey[] }[] = [
  { title: 'Macros', keys: ['kcal', 'proteines', 'glucides', 'lipides', 'fibres'] },
  { title: 'Lipides & oméga', keys: ['agSatures', 'agTrans', 'agMonoInsatures', 'agPolyInsatures', 'omega3', 'omega6', 'omega9'] },
  { title: 'Minéraux', keys: ['fer', 'magnesium', 'potassium', 'calcium', 'zinc', 'sodium', 'selenium', 'iode'] },
  { title: 'Vitamines', keys: ['vitA', 'vitC', 'vitD', 'vitE', 'vitK1', 'vitK2', 'vitB1', 'vitB2', 'vitB3', 'vitB5', 'vitB6', 'vitB9', 'vitB12'] },
];

/** Toutes les clés de nutriments (ordre de `Nutrients`). */
export const NUTRIENT_KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

/** Groupes nommés + groupe « Autres » calculé (nutriments non classés). */
export const NUTRIENT_GROUPS: { title: string; keys: NutrientKey[] }[] = (() => {
  const named = new Set(NUTRIENT_NAMED_GROUPS.flatMap((g) => g.keys));
  return [...NUTRIENT_NAMED_GROUPS, { title: 'Autres', keys: NUTRIENT_KEYS.filter((k) => !named.has(k)) }];
})();
