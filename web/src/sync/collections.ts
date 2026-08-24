/**
 * Descripteurs partagés entre le tracker de changements et le moteur de sync :
 * ils font le pont entre les collections du store Zustand et les tables Supabase
 * par entité. Ce module est la SEULE source de vérité de « quelle donnée du store
 * va dans quelle table » — ajouter une entité synchronisée = l'ajouter ici.
 */

import { useStore } from '../store/store';

/** État complet du store principal (type dérivé, sans l'exporter depuis store.ts). */
export type StoreState = ReturnType<typeof useStore.getState>;

/** Tables « par entité » : une ligne = un objet identifié par son id client. */
export type EntityTable =
  | 'journal_entries'
  | 'custom_foods'
  | 'favorite_meals'
  | 'weight_entries'
  | 'sun_exposures';

/** Singletons stockés dans `profile_kv` (clé = nom du champ). */
export type KvKey =
  | 'profile'
  | 'weightConfig'
  | 'mutedDays'
  | 'dayNotes'
  | 'nutrientImportance'
  | 'nutrientTargets';

/** Une entité : d'où lire ses lignes `[id, payload]` et sa référence brute (fast-path diff). */
interface EntitySpec {
  /** Référence brute de la collection dans l'état (comparaison d'identité = fast-path). */
  source: (s: StoreState) => unknown;
  /** Lignes `[id, payload]` à synchroniser. */
  rows: (s: StoreState) => (readonly [string, unknown])[];
}

export const ENTITY_SPECS: Record<EntityTable, EntitySpec> = {
  journal_entries: {
    source: (s) => s.entries,
    rows: (s) => s.entries.map((e) => [e.id, e] as const),
  },
  // Ma banque d'aliments. Les anciens `food_overrides` ont été absorbés dedans
  // par la migration : la table distante existe peut-être encore, elle n'est
  // simplement plus lue ni écrite.
  custom_foods: {
    source: (s) => s.customFoods,
    rows: (s) => s.customFoods.map((f) => [f.id, f] as const),
  },
  favorite_meals: {
    source: (s) => s.favoriteMeals,
    rows: (s) => s.favoriteMeals.map((m) => [m.id, m] as const),
  },
  weight_entries: {
    source: (s) => s.weightEntries,
    rows: (s) => s.weightEntries.map((e) => [e.id, e] as const),
  },
  sun_exposures: {
    source: (s) => s.sunExposures,
    rows: (s) => s.sunExposures.map((e) => [e.id, e] as const),
  },
};

export const ENTITY_TABLES = Object.keys(ENTITY_SPECS) as EntityTable[];

/** Accès en lecture aux singletons synchronisés. */
export const KV_SELECTORS: Record<KvKey, (s: StoreState) => unknown> = {
  profile: (s) => s.profile,
  weightConfig: (s) => s.weightConfig,
  mutedDays: (s) => s.mutedDays,
  dayNotes: (s) => s.dayNotes,
  nutrientImportance: (s) => s.nutrientImportance,
  nutrientTargets: (s) => s.nutrientTargets,
};

export const KV_KEYS = Object.keys(KV_SELECTORS) as KvKey[];

/** Clé d'une modification en attente : `table:id` (entités) ou `profile_kv:<key>`. */
export function pendingKey(table: EntityTable | 'profile_kv', id: string): string {
  return `${table}:${id}`;
}

/** Décompose une clé de `pending` en `[table, id]`. */
export function splitPendingKey(key: string): [EntityTable | 'profile_kv', string] {
  const i = key.indexOf(':');
  return [key.slice(0, i) as EntityTable | 'profile_kv', key.slice(i + 1)];
}
