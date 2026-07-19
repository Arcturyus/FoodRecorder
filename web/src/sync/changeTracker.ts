/**
 * Tracker de changements locaux : s'abonne au store principal et marque « dirty »
 * (dans `useSyncStore.pending`) toute création/modification/suppression d'une
 * entité synchronisée. On procède par DIFF d'état (pas par instrumentation des
 * actions) pour capter aussi les mutations hors action — notamment `importBackup`
 * (setState direct) et `resyncEntries` (reconstruction en masse) — sans risquer
 * d'oublier une action future.
 *
 * Deux garde-fous essentiels :
 *  - ne rien marquer tant qu'aucun profil n'est joint (coût nul pour l'existant) ;
 *  - ne rien marquer pendant l'application d'un pull (flag `applyingRemote`),
 *    sinon les données reçues seraient aussitôt re-poussées (boucle infinie).
 */

import { useStore } from '../store/store';
import { useSyncStore, type PendingChange } from './syncStore';
import {
  ENTITY_SPECS,
  ENTITY_TABLES,
  KV_KEYS,
  KV_SELECTORS,
  pendingKey,
  type StoreState,
} from './collections';

let applyingRemote = false;

/** Encadre l'application d'un état distant : les mutations émises ne sont pas marquées dirty. */
export function withRemoteApply<T>(fn: () => T): T {
  applyingRemote = true;
  try {
    return fn();
  } finally {
    applyingRemote = false;
  }
}

export function isApplyingRemote(): boolean {
  return applyingRemote;
}

/** Deux payloads sont-ils réellement différents ? (référence d'abord, JSON en secours.) */
function changed(a: unknown, b: unknown): boolean {
  if (a === b) return false;
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Diffe une collection entité et accumule les modifications dans `dirty`. */
function diffEntity(
  table: (typeof ENTITY_TABLES)[number],
  prev: StoreState,
  next: StoreState,
  now: number,
  dirty: Record<string, PendingChange>,
): void {
  const spec = ENTITY_SPECS[table];
  if (spec.source(prev) === spec.source(next)) return; // référence intacte → rien à faire
  const before = new Map(spec.rows(prev));
  const after = new Map(spec.rows(next));
  for (const [id, payload] of after) {
    if (!before.has(id) || changed(before.get(id), payload)) dirty[pendingKey(table, id)] = { updatedAt: now };
  }
  for (const id of before.keys()) {
    if (!after.has(id)) dirty[pendingKey(table, id)] = { updatedAt: now, deleted: true };
  }
}

let started = false;

/** Démarre le suivi des changements (idempotent — un seul abonnement). */
export function initChangeTracker(): void {
  if (started) return;
  started = true;
  useStore.subscribe((next, prev) => {
    if (applyingRemote) return;
    if (useSyncStore.getState().profileId == null) return;

    const now = Date.now();
    const dirty: Record<string, PendingChange> = {};

    for (const table of ENTITY_TABLES) diffEntity(table, prev, next, now, dirty);
    for (const key of KV_KEYS) {
      if (changed(KV_SELECTORS[key](prev), KV_SELECTORS[key](next))) dirty[pendingKey('profile_kv', key)] = { updatedAt: now };
    }

    if (Object.keys(dirty).length > 0) useSyncStore.getState().mergePending(dirty);
  });
}
