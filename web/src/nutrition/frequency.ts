/**
 * Fréquence de consommation des aliments sur une période : « quand ai-je mangé
 * du saumon ? », « qu'est-ce que je mange le plus ? ».
 *
 * Généralise `recentFoodCounts` (store.ts), qui ne compte que les occurrences
 * récentes par foodId pour départager le matching : ici on agrège aussi les
 * jours distincts, les grammes, les kcal et les dates, et on retient les
 * aliments non résolus (foodId null) sous leur nom affiché.
 */

import type { JournalEntry } from '../store/store';
import { normalizeForMatch } from './normalize';

/** Consommations d'un aliment agrégées sur la période. */
export interface FoodFrequency {
  /** foodId de la base, ou `nom:<libellé normalisé>` pour un aliment non résolu. */
  key: string;
  /** foodId si l'aliment est résolu (permet de retrouver sa catégorie/ses valeurs). */
  foodId: string | null;
  /** Libellé le plus récent rencontré pour cet aliment. */
  nom: string;
  /** Nombre de fois où l'aliment a été consommé (un item = une fois). */
  occurrences: number;
  /** Nombre de jours distincts où il a été consommé (≤ occurrences). */
  jours: number;
  grammes: number;
  kcal: number;
  /** Dates de consommation, triées, sans doublon (YYYY-MM-DD). */
  dates: string[];
  /** Dernière date de consommation. */
  derniere: string;
}

/** Clé d'agrégation : le foodId prime, sinon le nom affiché normalisé. */
export function frequencyKey(foodId: string | null, nom: string): string {
  return foodId ?? `nom:${normalizeForMatch(nom)}`;
}

/**
 * Agrège les consommations par aliment sur une plage de dates inclusive.
 * Résultat trié par occurrences décroissantes (puis alphabétiquement, pour un
 * ordre stable à égalité).
 */
export function foodFrequencies(
  entries: JournalEntry[],
  range: { start: string; end: string },
): FoodFrequency[] {
  const map = new Map<string, FoodFrequency & { dateSet: Set<string> }>();

  // Ordre chronologique : le libellé retenu est ainsi celui de la consommation
  // la plus récente (l'aliment a pu être renommé/réassocié entre-temps).
  const sorted = [...entries]
    .filter((e) => e.date >= range.start && e.date <= range.end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

  for (const e of sorted) {
    for (const it of e.items) {
      const key = frequencyKey(it.foodId, it.nomAffiche);
      let f = map.get(key);
      if (!f) {
        f = {
          key,
          foodId: it.foodId,
          nom: it.nomAffiche,
          occurrences: 0,
          jours: 0,
          grammes: 0,
          kcal: 0,
          dates: [],
          derniere: e.date,
          dateSet: new Set(),
        };
        map.set(key, f);
      }
      f.nom = it.nomAffiche;
      f.occurrences++;
      f.grammes += it.grams;
      f.kcal += it.nutrients.kcal ?? 0;
      f.dateSet.add(e.date);
      if (e.date > f.derniere) f.derniere = e.date;
    }
  }

  return [...map.values()]
    .map(({ dateSet, ...f }) => ({ ...f, jours: dateSet.size, dates: [...dateSet].sort() }))
    .sort((a, b) => b.occurrences - a.occurrences || a.nom.localeCompare(b.nom, 'fr'));
}

/**
 * Occurrences par jour d'un aliment donné, sur les dates fournies (0 inclus) :
 * série prête à tracer.
 */
export function occurrencesByDate(freq: FoodFrequency, entries: JournalEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!freq.dates.includes(e.date)) continue;
    for (const it of e.items) {
      if (frequencyKey(it.foodId, it.nomAffiche) !== freq.key) continue;
      counts.set(e.date, (counts.get(e.date) ?? 0) + 1);
    }
  }
  return counts;
}
