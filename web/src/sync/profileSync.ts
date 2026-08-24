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
  loginProfile,
  signupProfile,
  signOut,
  hasValidSession,
  renameProfile,
  fetchRowsSince,
  fetchAllRows,
  countRows,
  upsertRows,
  isAuthError,
  type DbRow,
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

/** Champs singletons (`profile`, `weightConfig`, `mutedDays`…) à écraser depuis le distant. */
function kvUpdates(rows: DbRow[]): Partial<StoreState> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.deleted || !r.payload) continue; // on ne supprime jamais un singleton
    if (r.key === 'profile') out.profile = r.payload;
    if (r.key === 'weightConfig') out.weightConfig = r.payload;
    if (r.key === 'mutedDays') out.mutedDays = r.payload;
    if (r.key === 'dayNotes') out.dayNotes = r.payload;
    if (r.key === 'nutrientImportance') out.nutrientImportance = r.payload;
    if (r.key === 'nutrientTargets') out.nutrientTargets = r.payload;
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
      const entries = resyncEntries(
        mergeArray(s.entries, remote.tables.journal_entries),
        effectiveFoods(customFoods),
      );
      return {
        entries,
        customFoods,
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
      const entries = resyncEntries(liveArray<JournalEntry>(remote.tables.journal_entries), effectiveFoods(customFoods));
      return {
        entries,
        customFoods,
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

/**
 * Suspend la synchro et GARDE le nom du profil, pour que l'UI propose de ressaisir le mot de passe
 * plutôt que de faire disparaître le profil. Appelé quand la base refuse la session.
 */
export function expireSession(): void {
  useSyncStore.getState().setSessionExpired();
}

/**
 * Au démarrage : une session Supabase persistée peut avoir expiré pendant que l'app était fermée.
 * On le constate ici plutôt que d'attendre le premier appel réseau raté, pour afficher tout de
 * suite la demande de mot de passe.
 */
export async function restoreSession(): Promise<void> {
  const { profileId, sessionExpired } = useSyncStore.getState();
  if (!isSyncConfigured() || !profileId || sessionExpired) return;
  if (!(await hasValidSession())) expireSession();
}

/** Un tick complet : pull puis push. No-op si non configuré, sans profil, session expirée, ou déjà en cours. */
export async function runProfileSyncTick(): Promise<void> {
  const sync = useSyncStore.getState();
  if (!isSyncConfigured() || sync.profileId == null || sync.sessionExpired || running) return;
  running = true;
  try {
    await pull(sync.profileId);
    await push(sync.profileId);
    useSyncStore.getState().setSynced(Date.now());
  } catch (e) {
    // Jeton refusé par PostgREST → reconnexion nécessaire. On se fie au CODE de l'erreur et non à
    // son texte : « permission denied » se produit aussi pour des refus légitimes, et déconnecter
    // l'utilisateur sur ce motif serait une régression déclenchée par une simple erreur de droits.
    if (isAuthError(e)) expireSession();
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

/**
 * Crée le compte d'un profil et pousse tout l'état local comme référence. Sert AUSSI à adopter un
 * profil d'avant l'authentification, qui existe en base sans compte rattaché (cf. `signupProfile`).
 */
export async function createAndPushProfile(name: string, password: string): Promise<void> {
  const auth = await signupProfile(name, password);
  useSyncStore.getState().setSession(auth.id, auth.name);
  seedAllPending();
  await runProfileSyncTick();
}

export type JoinStrategy = 'pull' | 'push' | 'merge';

export interface JoinPreview {
  profile: { id: string; name: string };
  cloudEntries: number;
  localEntries: number;
}

/**
 * Aperçu avant jonction : se connecte (échoue si le mot de passe est faux), puis compare le nombre
 * de repas cloud et local. La connexion doit précéder le comptage — sous RLS, une requête non
 * authentifiée ne verrait rien et annoncerait un profil vide. `joinProfile` réutilise la session
 * ainsi ouverte, sans redemander le mot de passe.
 */
export async function getJoinPreview(name: string, password: string): Promise<JoinPreview> {
  const auth = await loginProfile(name, password);
  try {
    const cloudEntries = await countRows('journal_entries', auth.id);
    return {
      profile: { id: auth.id, name: auth.name },
      cloudEntries,
      localEntries: useStore.getState().entries.length,
    };
  } catch (e) {
    // Échec après connexion : ne pas laisser une session ouverte sur un profil non rejoint.
    await signOut();
    throw e;
  }
}

/**
 * Rejoint un profil existant selon la stratégie choisie (le mot de passe a déjà été vérifié par
 * `getJoinPreview`, dont la session est réutilisée ici). Dans TOUS les cas, une sauvegarde JSON du
 * navigateur est téléchargée d'abord (filet de sécurité).
 *  - 'pull'  : le cloud remplace le local (recommandé).
 *  - 'push'  : le local écrase le cloud.
 *  - 'merge' : fusion par id (le cloud gagne les conflits), puis l'union remonte.
 */
export async function joinProfile(preview: JoinPreview, strategy: JoinStrategy): Promise<void> {
  const { id, name } = preview.profile;
  exportJsonFile();
  const remote = await fetchAll(id);

  if (strategy === 'pull') {
    replaceFromRemote(remote);
    useSyncStore.getState().setSession(id, name);
    useSyncStore.getState().setCursor(maxCursor(remote));
    useSyncStore.getState().setSynced(Date.now());
    return;
  }

  if (strategy === 'push') {
    useSyncStore.getState().setSession(id, name);
    useSyncStore.getState().setCursor(maxCursor(remote)); // ne pas re-télécharger l'existant
    tombstoneRemoteAbsent(remote);
    seedAllPending();
    await runProfileSyncTick();
    return;
  }

  // merge
  useSyncStore.getState().setSession(id, name);
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
export async function leaveProfile(): Promise<void> {
  await signOut();
  useSyncStore.getState().clearSession();
}

/**
 * Annule proprement une jonction en cours : `getJoinPreview` ouvre une session pour pouvoir compter
 * les repas du profil, avant même que l'utilisateur ait choisi une stratégie. S'il renonce, il faut
 * refermer cette session — sinon le client reste authentifié sur un profil que le store n'a pas
 * rejoint.
 */
export async function cancelJoin(): Promise<void> {
  await signOut();
}

/**
 * Reconnexion après expiration : on lève UNIQUEMENT le drapeau (`renewSession`), sans repasser par
 * `setSession` qui repart d'un profil vierge. La distinction est cruciale — les modifications
 * faites pendant l'expiration sont encore dans `pending`, et les remettre à zéro ici les
 * supprimerait définitivement sans qu'elles aient jamais atteint le cloud.
 *
 * Sécurité : le nom vient du store, mais l'`id` vient du serveur — si ce nom désigne désormais un
 * autre profil, on refuse plutôt que de synchroniser sur les données de quelqu'un d'autre.
 */
export async function reauthenticate(password: string): Promise<void> {
  const { profileName, profileId } = useSyncStore.getState();
  if (!profileName || !profileId) throw new Error('Aucun profil à reconnecter.');
  const auth = await loginProfile(profileName, password);
  if (auth.id !== profileId) {
    await signOut();
    throw new Error('Ce nom correspond désormais à un autre profil. Déconnectez-vous puis rejoignez-le.');
  }
  useSyncStore.getState().renewSession();
  await runProfileSyncTick();
}
