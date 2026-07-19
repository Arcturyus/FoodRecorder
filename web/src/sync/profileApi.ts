/**
 * Accès Supabase pour les profils et leurs tables par entité. Couche fine
 * (mêmes conventions que `supabase.ts`) : chaque fonction lève une Error en cas
 * d'échec, le moteur de sync décide quoi en faire. Le schéma est dans
 * `supabase/schema.sql`.
 */

import { supabase } from './supabase';
import type { EntityTable } from './collections';

/** Nom de table synchronisée (entités + singleton clé/valeur). */
export type SyncTable = EntityTable | 'profile_kv';

export interface ProfileRow {
  id: string;
  name: string;
}

/** Une ligne d'une table synchronisée telle que stockée/reçue. */
export interface DbRow {
  profile_id: string;
  /** Id client (tables entité). */
  id?: string;
  /** Clé (table `profile_kv`). */
  key?: string;
  payload: unknown;
  updated_at: number;
  deleted: boolean;
  device: string | null;
  synced_at?: string;
}

function client() {
  if (!supabase) throw new Error('Synchronisation non configurée (Supabase absent).');
  return supabase;
}

/** Cherche un profil par nom (insensible à la casse). `null` si absent. */
export async function findProfileByName(name: string): Promise<ProfileRow | null> {
  const { data, error } = await client().from('profiles').select('id,name').ilike('name', name.trim()).limit(1);
  if (error) throw new Error(error.message);
  return data && data.length > 0 ? (data[0] as ProfileRow) : null;
}

/** Crée un profil ; lève une erreur explicite si le nom est déjà pris. */
export async function createProfile(name: string): Promise<ProfileRow> {
  const { data, error } = await client()
    .from('profiles')
    .insert({ name: name.trim() })
    .select('id,name')
    .single();
  if (error) throw new Error(error.code === '23505' ? 'Ce nom de profil est déjà pris.' : error.message);
  return data as ProfileRow;
}

/** Renomme un profil (id stable). Lève une erreur si le nouveau nom est pris. */
export async function renameProfile(id: string, name: string): Promise<void> {
  const { error } = await client()
    .from('profiles')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new Error(error.code === '23505' ? 'Ce nom est déjà pris.' : error.message);
}

/** Lignes d'une table modifiées depuis `cursor` par d'AUTRES appareils (anti-écho). */
export async function fetchRowsSince(
  table: SyncTable,
  profileId: string,
  cursor: string | null,
  deviceId: string,
): Promise<DbRow[]> {
  let q = client().from(table).select('*').eq('profile_id', profileId).neq('device', deviceId);
  if (cursor) q = q.gt('synced_at', cursor);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as DbRow[];
}

/** Toutes les lignes vivantes (non supprimées) d'une table pour un profil. */
export async function fetchAllRows(table: SyncTable, profileId: string): Promise<DbRow[]> {
  const { data, error } = await client().from(table).select('*').eq('profile_id', profileId).eq('deleted', false);
  if (error) throw new Error(error.message);
  return (data ?? []) as DbRow[];
}

/** Nombre de lignes vivantes d'une table (pour éclairer le choix à la jonction). */
export async function countRows(table: SyncTable, profileId: string): Promise<number> {
  const { count, error } = await client()
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('deleted', false);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Upsert par lots de 500 (le push initial d'un journal complet peut être volumineux). */
export async function upsertRows(table: SyncTable, rows: DbRow[]): Promise<void> {
  if (rows.length === 0) return;
  const onConflict = table === 'profile_kv' ? 'profile_id,key' : 'profile_id,id';
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client().from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(error.message);
  }
}
