import type { JournalEntry } from '../store/store';

/**
 * Regroupement des entrées d'une journée en REPAS.
 *
 * Une entrée du journal est une saisie, pas un repas : « steak haché », puis
 * « ketchup » trente secondes plus tard, puis « brocolis » — trois cartes pour
 * une seule assiette. En vue compacte, ces trois lignes prennent la place de
 * trois repas alors qu'elles n'en décrivent qu'un.
 *
 * On ne dispose que de l'heure d'ENREGISTREMENT (`createdAt`), jamais de l'heure
 * réelle du repas : deux saisies rapprochées sont donc supposées être le même
 * repas. C'est vrai quand on saisit en mangeant — le cas courant — et faux quand
 * on rattrape une journée entière le soir, où tout tombe dans la même demi-heure.
 * D'où la correction manuelle (`mealLink` sur l'entrée), qui prime toujours sur
 * la règle.
 *
 * Le regroupement est un AFFICHAGE : les entrées ne sont pas fusionnées, rien
 * n'est réécrit, et changer la règle ne touche aucune donnée.
 */

/** Deux saisies plus rapprochées que ça sont le même repas. */
export const MEAL_GAP_MIN = 30;
const MEAL_GAP_MS = MEAL_GAP_MIN * 60_000;

export interface Meal {
  /** Id de la première entrée du repas : stable tant que le repas existe. */
  id: string;
  /** Entrées du repas, du plus ancien au plus récent. */
  entries: JournalEntry[];
  /** Horodatage de la première saisie du repas. */
  start: number;
  kcal: number;
  /** Nombre d'aliments, toutes entrées confondues. */
  itemCount: number;
}

function entryKcal(e: JournalEntry): number {
  return e.items.reduce((a, it) => a + it.nutrients.kcal, 0);
}

/**
 * Découpe les entrées d'un jour en repas, du plus ancien au plus récent.
 * L'ordre d'entrée n'importe pas : le tri chronologique est fait ici, car la
 * règle des 30 minutes n'a de sens que sur des saisies ordonnées.
 */
export function groupIntoMeals(entries: JournalEntry[], gapMs = MEAL_GAP_MS): Meal[] {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const meals: Meal[] = [];
  for (const e of sorted) {
    const current = meals[meals.length - 1];
    const previous = current?.entries[current.entries.length - 1];
    // La correction manuelle prime sur l'écart de temps, dans les deux sens.
    const joins =
      previous != null &&
      (e.mealLink === 'join' || (e.mealLink !== 'break' && e.createdAt - previous.createdAt <= gapMs));
    if (joins && current) {
      current.entries.push(e);
      current.kcal += entryKcal(e);
      current.itemCount += e.items.length;
    } else {
      meals.push({ id: e.id, entries: [e], start: e.createdAt, kcal: entryKcal(e), itemCount: e.items.length });
    }
  }
  return meals;
}

/**
 * Résumé d'un repas en une ligne : les aliments, séparés par des virgules
 * (« viande hachée, ketchup, brocolis »). Un même aliment répété n'est nommé
 * qu'une fois — deux cafés dans la même heure ne valent pas deux mentions.
 *
 * La dictée n'est PAS utilisée ici, contrairement au résumé d'une entrée seule :
 * mises bout à bout, trois dictées font une ligne illisible, alors que les noms
 * d'aliments restent une énumération. Le texte n'est pas tronqué ici mais par le
 * CSS : couper à N caractères couperait au milieu d'un mot différent selon la
 * largeur de l'écran.
 */
export function mealSummary(meal: Meal): string {
  const noms: string[] = [];
  const vus = new Set<string>();
  for (const e of meal.entries) {
    for (const it of e.items) {
      const cle = it.nomAffiche.toLowerCase();
      if (vus.has(cle)) continue;
      vus.add(cle);
      noms.push(it.nomAffiche);
    }
  }
  return noms.join(', ');
}

/** Place d'une entrée dans son repas — ce dont la carte a besoin pour proposer la bonne correction. */
export interface MealPosition {
  /** L'entrée ouvre son repas : c'est elle qui peut être rattachée au précédent. */
  isFirst: boolean;
  /** Heure de début du repas qui précède, s'il y en a un (libellé du bouton). */
  previousStart: number | null;
}

/** Position de chaque entrée (par id) dans le découpage en repas. */
export function mealPositions(meals: Meal[]): Map<string, MealPosition> {
  const out = new Map<string, MealPosition>();
  meals.forEach((meal, i) => {
    meal.entries.forEach((e, j) => {
      out.set(e.id, { isFirst: j === 0, previousStart: i > 0 ? meals[i - 1].start : null });
    });
  });
  return out;
}
