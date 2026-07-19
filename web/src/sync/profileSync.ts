/**
 * Moteur de synchronisation par profil : pull (récupération) puis push (envoi),
 * arbitrage last-write-wins ligne à ligne, et les opérations de cycle de vie
 * d'un profil (création, jonction avec ses 3 stratégies, renommage, départ).
 *
 * Principes :
 *  - Local-first : le store principal reste la source immédiate ; la sync est un
 *    confort en arrière-plan et un no-op silencieux hors ligne (le `pending`
 *    persiste et sera rejoué).
 *  - Anti-boucle : toute application de données distantes passe par
 *    `withRemoteApply` (cf. changeTracker) — jamais par les actions du store, qui
 *    régénéreraient des ids et re-marqueraient dirty.
 *  - Anti-écho : le pull ne lit que les lignes d'AUTRES appareils (filtre device
 *    côté SQL), nos propres pushes ne nous reviennent donc jamais.
 */

import {
  useStore,
  effectiveFoods,
  resyncEntries,
  normalizeNutrients,
  type JournalEntry,
  type FavoriteMeal,
  type FoodOverrides,
} from '../store/store';
import type { Food } from '../nutrition/types';
import type { WeightEntry } from '../weight/types';
import { normalizeCreme, type SunExposure } from '../sun/vitaminD';
import { exportJsonFile } from '../store/backup';
import { isSyncConfigured } from './supabase';
import { useSyncStore, type PendingChange } from './syncStore';
import { withRemoteApply } from './changeTracker';
import {
  ENTITY_SPECS,
  ENTITY_TABLES,
  KV_KEYS,
  KV_SELECTORS,
  pendingKey,
  splitPendingKey,
  type EntityTable,
  type KvKey,
  type StoreState,
} from './collections';
import {
  findProfileByName,
  createProfile,
  renameProfile,
  fetchRowsSince,
  fetchAllRows,
  countRows,
  upsertRows,
  type DbRow,
  type ProfileRow,
  type SyncTable,
} from './profileApi';

const ALL_TABLES: SyncTable[] = [...ENTITY_TABLES, 'profile_kv'];

/** Données distantes regroupées par table. */
interface RemoteData {
  tables: Record<EntityTable, DbRow[]>;
  kv: DbRow[];
}

// ---------------------------------------------------------------------------
// Récupération
// ---------------------------------------------------------------------------

function toRemoteData(results: DbRow[][]): RemoteData {
  const tables = {} as Record<EntityTable, DbRow[]>;
  let kv: DbRow[] = [];
  ALL_TABLES.forEach((t, i) => {
    if (t === 'profile_kv') kv = results[i];
    else tables[t] = results[i];
  });
  return { tables, kv };
}

async function fetchSince(profileId: string, cursor: string | null, deviceId: string): Promise<RemoteData> {
  return toRemoteData(await Promise.all(ALL_TABLES.map((t) => fetchRowsSince(t, profileId, cursor, deviceId))));
}

async function fetchAll(profileId: string): Promise<RemoteData> {
  return toRemoteData(await Promise.all(ALL_TABLES.map((t) => fetchAllRows(t, profileId))));
}

/** Plus grand `synced_at` de toutes les lignes reçues (nouveau curseur de pull). */
function maxCursor(remote: RemoteData): string | null {
  let max: string | null = null;
  const all = ALL_TABLES.flatMap((t) => (t === 'profile_kv' ? remote.kv : remote.tables[t]));
  for (const r of all) if (r.synced_at && (max === null || r.synced_at > max)) max = r.synced_at;
  return max;
}

// ---------------------------------------------------------------------------
// Application au store
// ---------------------------------------------------------------------------

function liveArray<T>(rows: DbRow[]): T[] {
  return rows.filter((r) => !r.deleted).map((r) => r.payload as T);
}

function liveRecord(rows: DbRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) if (!r.deleted && r.id) out[r.id] = r.payload;
  return out;
}

/** Fusion delta d'une collection tableau : upsert / suppression par id. */
function mergeArray<T extends { id: string }>(local: T[], rows: DbRow[]): T[] {
  const map = new Map(local.map((x) => [x.id, x]));
  for (const r of rows) {
    if (!r.id) continue;
    if (r.deleted) map.delete(r.id);
    else map.set(r.id, r.payload as T);
  }
  return [...map.values()];
}

/** Fusion delta d'un Record (overrides) : upsert / suppression par clé. */
function mergeRecord(local: Record<string, unknown>, rows: DbRow[]): Record<string, unknown> {
  const out = { ...local };
  for (const r of rows) {
    if (!r.id) continue;
    if (r.deleted) delete out[r.id];
    else out[r.id] = r.payload;
  }
  return out;
}

/** Champs singletons (`profile`, `weightConfig`) à écraser depuis le distant. */
function kvUpdates(rows: DbRow[]): Partial<StoreState> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.deleted || !r.payload) continue; // on ne supprime jamais un singleton
    if (r.key === 'profile') out.profile = r.payload;
    if (r.key === 'weightConfig') out.weightConfig = r.payload;
  }
  return out as Partial<StoreState>;
}

/** Recalcule les nutriments et normalise, exactement comme `mergePersisted`. */
function normalizeCustomFoods(foods: Food[]): Food[] {
  return foods.map((f) => ({ ...f, n: normalizeNutrients(f.n) }));
}

function normalizeSun(exposures: SunExposure[]): SunExposure[] {
  return exposures.map((e) => ({ ...e, creme: normalizeCreme(e.creme) }));
}

/** Applique un delta distant au store courant (fusion par id, recalcul nutriments). */
function applyDelta(remote: RemoteData): void {
  const hasAny = ALL_TABLES.some((t) => (t === 'profile_kv' ? remote.kv : remote.tables[t]).length > 0);
  if (!hasAny) return;
  withRemoteApply(() =>
    useStore.setState((s) => {
      const customFoods = normalizeCustomFoods(mergeArray(s.customFoods, remote.tables.custom_foods));
      const foodOverrides = mergeRecord(s.foodOverrides, remote.tables.food_overrides) as FoodOverrides;
      const entries = resyncEntries(
        mergeArray(s.entries, remote.tables.journal_entries),
        effectiveFoods(customFoods, foodOverrides),
      );
      return {
        entries,
        customFoods,
        foodOverrides,
        favoriteMeals: mergeArray(s.favoriteMeals, remote.tables.favorite_meals),
        weightEntries: mergeArray(s.weightEntries, remote.tables.weight_entries),
        sunExposures: normalizeSun(mergeArray(s.sunExposures, remote.tables.sun_exposures)),
        ...kvUpdates(remote.kv),
      };
    }),
  );
}

/** Remplace TOTALEMENT les données locales par le distant (stratégie « télécharger »). */
function replaceFromRemote(remote: RemoteData): void {
  withRemoteApply(() =>
    useStore.setState(() => {
      const customFoods = normalizeCustomFoods(liveArray<Food>(remote.tables.custom_foods));
      const foodOverrides = liveRecord(remote.tables.food_overrides) as FoodOverrides;
      const entries = resyncEntries(liveArray<JournalEntry>(remote.tables.journal_entries), effectiveFoods(customFoods, foodOverrides));
      return {
        entries,
        customFoods,
        foodOverrides,
        favoriteMeals: liveArray<FavoriteMeal>(remote.tables.favorite_meals),
        weightEntries: liveArray<WeightEntry>(remote.tables.weight_entries),
        sunExposures: normalizeSun(liveArray<SunExposure>(remote.tables.sun_exposures)),
        ...kvUpdates(remote.kv),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Tick de synchronisation (pull puis push)
// ---------------------------------------------------------------------------

/** Écarte les lignes distantes perdantes face à une modification locale plus récente. */
function filterByPending(remote: RemoteData): RemoteData {
  const pending = useSyncStore.getState().pending;
  const keep = (table: SyncTable, rows: DbRow[]): DbRow[] =>
    rows.filter((r) => {
      const id = table === 'profile_kv' ? r.key : r.id;
      if (!id) return false;
      const p = pending[pendingKey(table, id)];
      return !p || r.updated_at > p.updatedAt; // local ≥ distant ⇒ on garde le local
    });
  return {
    tables: Object.fromEntries(ENTITY_TABLES.map((t) => [t, keep(t, remote.tables[t])])) as Record<EntityTable, DbRow[]>,
    kv: keep('profile_kv', remote.kv),
  };
}

async function pull(profileId: string): Promise<void> {
  const { deviceId } = useStore.getState();
  const cursor = useSyncStore.getState().pullCursor;
  const remote = await fetchSince(profileId, cursor, deviceId);
  applyDelta(filterByPending(remote));
  const next = maxCursor(remote);
  if (next && next !== cursor) useSyncStore.getState().setCursor(next);
}

async function push(profileId: string): Promise<void> {
  const snapshot = { ...useSyncStore.getState().pending };
  const keys = Object.keys(snapshot);
  if (keys.length === 0) return;

  const s = useStore.getState();
  const { deviceId } = s;
  const rowMaps = new Map<EntityTable, Map<string, unknown>>();
  for (const t of ENTITY_TABLES) rowMaps.set(t, new Map(ENTITY_SPECS[t].rows(s)));

  const byTable = new Map<SyncTable, DbRow[]>();
  const pushedKeys: string[] = [];
  for (const key of keys) {
    const [table, id] = splitPendingKey(key);
    const change = snapshot[key];
    let payload: unknown = null;
    if (!change.deleted) {
      if (table === 'profile_kv') {
        payload = KV_SELECTORS[id as KvKey](s);
      } else {
        const map = rowMaps.get(table)!;
        if (!map.has(id)) continue; // disparu sans tombstone ⇒ revu au prochain tick
        payload = map.get(id);
      }
    }
    const base = { profile_id: profileId, payload, updated_at: change.updatedAt, deleted: !!change.deleted, device: deviceId };
    const row: DbRow = table === 'profile_kv' ? { ...base, key: id } : { ...base, id };
    const list = byTable.get(table) ?? [];
    list.push(row);
    byTable.set(table, list);
    pushedKeys.push(key);
  }

  for (const [table, rows] of byTable) await upsertRows(table, rows);
  useSyncStore.getState().clearPushed(pushedKeys, snapshot);
}

let running = false;

/** Un tick complet : pull puis push. No-op si non configuré, sans profil, ou déjà en cours. */
export async function runProfileSyncTick(): Promise<void> {
  const sync = useSyncStore.getState();
  if (!isSyncConfigured() || sync.profileId == null || running) return;
  running = true;
  try {
    await pull(sync.profileId);
    await push(sync.profileId);
    useSyncStore.getState().setSynced(Date.now());
  } catch (e) {
    // Réseau coupé / Supabase injoignable : la sync est un confort, jamais bloquante.
    useSyncStore.getState().setError((e as Error).message);
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// Cycle de vie d'un profil
// ---------------------------------------------------------------------------

/** Marque TOUT l'état local comme à pousser (référence initiale). */
export function seedAllPending(): void {
  const s = useStore.getState();
  const now = Date.now();
  const pending: Record<string, PendingChange> = {};
  for (const t of ENTITY_TABLES) for (const [id] of ENTITY_SPECS[t].rows(s)) pending[pendingKey(t, id)] = { updatedAt: now };
  for (const key of KV_KEYS) pending[pendingKey('profile_kv', key)] = { updatedAt: now };
  useSyncStore.getState().mergePending(pending);
}

/** Tombstones pour les lignes cloud absentes du local (stratégie « envoyer mon local »). */
function tombstoneRemoteAbsent(remote: RemoteData): void {
  const s = useStore.getState();
  const now = Date.now();
  const pending: Record<string, PendingChange> = {};
  for (const t of ENTITY_TABLES) {
    const localIds = new Set(ENTITY_SPECS[t].rows(s).map(([id]) => id));
    for (const r of remote.tables[t]) if (r.id && !localIds.has(r.id)) pending[pendingKey(t, r.id)] = { updatedAt: now, deleted: true };
  }
  useSyncStore.getState().mergePending(pending);
}

/** Crée un profil et pousse tout l'état local comme référence. */
export async function createAndPushProfile(name: string): Promise<void> {
  const existing = await findProfileByName(name);
  if (existing) throw new Error('Ce nom de profil existe déjà. Utilisez « Rejoindre » pour vous y connecter.');
  const prof = await createProfile(name);
  useSyncStore.getState().setProfile(prof.id, prof.name);
  seedAllPending();
  await runProfileSyncTick();
}

export type JoinStrategy = 'pull' | 'push' | 'merge';

export interface JoinPreview {
  profile: ProfileRow;
  cloudEntries: number;
  localEntries: number;
}

/** Aperçu avant jonction : profil trouvé + nb de repas cloud vs local. */
export async function getJoinPreview(name: string): Promise<JoinPreview> {
  const prof = await findProfileByName(name);
  if (!prof) throw new Error('Aucun profil à ce nom. Vérifiez l’orthographe, ou créez-le.');
  const cloudEntries = await countRows('journal_entries', prof.id);
  return { profile: prof, cloudEntries, localEntries: useStore.getState().entries.length };
}

/**
 * Rejoint un profil existant selon la stratégie choisie. Dans TOUS les cas, une
 * sauvegarde JSON du navigateur est téléchargée d'abord (filet de sécurité).
 *  - 'pull'  : le cloud remplace le local (recommandé).
 *  - 'push'  : le local écrase le cloud.
 *  - 'merge' : fusion par id (le cloud gagne les conflits), puis l'union remonte.
 */
export async function joinProfile(name: string, strategy: JoinStrategy): Promise<void> {
  const prof = await findProfileByName(name);
  if (!prof) throw new Error('Aucun profil à ce nom. Vérifiez l’orthographe, ou créez-le.');

  exportJsonFile();
  const remote = await fetchAll(prof.id);

  if (strategy === 'pull') {
    replaceFromRemote(remote);
    useSyncStore.getState().setProfile(prof.id, prof.name);
    useSyncStore.getState().setCursor(maxCursor(remote));
    useSyncStore.getState().setSynced(Date.now());
    return;
  }

  if (strategy === 'push') {
    useSyncStore.getState().setProfile(prof.id, prof.name);
    useSyncStore.getState().setCursor(maxCursor(remote)); // ne pas re-télécharger l'existant
    tombstoneRemoteAbsent(remote);
    seedAllPending();
    await runProfileSyncTick();
    return;
  }

  // merge
  useSyncStore.getState().setProfile(prof.id, prof.name);
  applyDelta(remote);
  useSyncStore.getState().setCursor(maxCursor(remote));
  seedAllPending();
  await runProfileSyncTick();
}

/** Renomme le profil connecté (id stable → transparent pour les autres appareils). */
export async function renameCurrentProfile(name: string): Promise<void> {
  const { profileId } = useSyncStore.getState();
  if (!profileId) throw new Error('Aucun profil connecté.');
  await renameProfile(profileId, name);
  useSyncStore.getState().setProfileName(name.trim());
}

/** Se déconnecte du profil (les données locales restent intactes). */
export function leaveProfile(): void {
  useSyncStore.getState().setProfile(null, null);
}
