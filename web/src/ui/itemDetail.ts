import { EMPTY_NUTRIENTS } from '../nutrition/types';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import { round } from './format';

/**
 * Nutriments détaillés d'un item, regroupés par famille (ordre d'affichage).
 * Les sous-détails (C16+C14 / stéarique, ALA/EPA/DHA) suivent immédiatement leur
 * parent : le rendu les décale via `parent` de la cible, comme sous les tuiles
 * du bilan.
 */
export const DETAIL_GROUPS: { title: string; keys: NutrientKey[] }[] = [
  { title: 'Macros', keys: ['kcal', 'proteines', 'glucides', 'lipides', 'fibres', 'alcool'] },
  {
    title: 'Lipides & oméga',
    keys: [
      'agSatures', 'agSaturesLdl', 'agSaturesStearique',
      'agTrans', 'agMonoInsatures', 'agPolyInsatures',
      'omega3', 'omega3Ala', 'omega3Epa', 'omega3Dha',
      'omega6', 'omega9',
    ],
  },
  { title: 'Minéraux', keys: ['fer', 'magnesium', 'potassium', 'calcium', 'zinc', 'sodium', 'selenium', 'iode'] },
  { title: 'Vitamines', keys: ['vitA', 'vitC', 'vitD', 'vitE', 'vitK1', 'vitK2', 'vitB1', 'vitB2', 'vitB3', 'vitB5', 'vitB6', 'vitB9', 'vitB12'] },
  { title: 'Autres', keys: ['creatine', 'collagene'] },
];

/**
 * Libellé court des sous-parts dans la grille du détail : les cellules font
 * 150 px, où « AG saturés à limiter (C16+C14) » se tronque au point d'être
 * illisible. Mêmes mots que la ligne « dont … » sous les tuiles du bilan ; le
 * libellé complet reste au survol.
 */
export const SHORT_LABELS: Partial<Record<NutrientKey, string>> = {
  agSaturesLdl: 'à limiter (C16+C14)',
  agSaturesStearique: 'stéarique (C18)',
  omega3Ala: 'ALA',
  omega3Epa: 'EPA',
  omega3Dha: 'DHA',
};

/** Valeurs de départ du formulaire d'ajustement (vide = zéro, pour ne pas saisir des « 0 »). */
export function nutrientsToDraft(nutrients: Nutrients): Record<string, string> {
  const d: Record<string, string> = {};
  for (const k of Object.keys(EMPTY_NUTRIENTS) as NutrientKey[]) {
    const v = nutrients[k] ?? 0;
    d[k] = v ? String(round(v, v < 10 ? 2 : 0)) : '';
  }
  return d;
}

/**
 * Reconstruit l'apport réel d'un item à partir du formulaire. On part des
 * valeurs ACTUELLES et non de zéro : un nutriment que le formulaire n'affiche
 * pas (pas de cible définie, ou clé ajoutée après coup) doit survivre à
 * l'ajustement. Partir de `EMPTY_NUTRIENTS` remettait silencieusement à 0 la
 * répartition des AG saturés, celle des oméga 3 et le collagène.
 */
export function draftToContribution(
  current: Nutrients,
  draft: Record<string, string>,
  groups: { keys: NutrientKey[] }[] = DETAIL_GROUPS,
): Nutrients {
  const out: Nutrients = { ...EMPTY_NUTRIENTS, ...current };
  for (const g of groups) {
    for (const k of g.keys) {
      const raw = draft[k];
      out[k] = !raw ? 0 : parseFloat(raw.replace(',', '.')) || 0;
    }
  }
  return out;
}
