import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ExtractedItem } from '../nutrition/types';

/**
 * Synchronisation optionnelle entre appareils via une table Supabase partagée
 * (« sync_queue »). Sert de boîte aux lettres : un appareil dépose une
 * transcription en attente de traitement, un autre (typiquement l'ordinateur,
 * avec le pont Claude Code) la traite et redépose le résultat, que tous les
 * appareils récupèrent ensuite dans leur journal local.
 * Sans configuration (.env.local absent), la synchro est simplement désactivée.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey) : null;

export function isSyncConfigured(): boolean {
  return supabase !== null;
}

export interface TranscriptPayload {
  transcript: string;
  date?: string;
}

export interface EntryPayload {
  transcript: string;
  items: ExtractedItem[];
  source: 'claudecode';
  date?: string;
}

interface SyncRow<T> {
  id: string;
  device: string;
  kind: 'transcript' | 'entry';
  payload: T;
  processed: boolean;
  created_at: string;
}

/** Dépose une transcription en attente de traitement par un autre appareil. */
export async function pushTranscript(device: string, transcript: string, date?: string): Promise<void> {
  if (!supabase) return;
  const payload: TranscriptPayload = { transcript, ...(date ? { date } : {}) };
  const { error } = await supabase
    .from('sync_queue')
    .insert({ device, kind: 'transcript', payload, processed: false });
  if (error) throw new Error(error.message);
}

/** Récupère les transcriptions en attente (tous appareils confondus). */
export async function fetchPendingTranscripts(): Promise<SyncRow<TranscriptPayload>[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('sync_queue')
    .select('*')
    .eq('kind', 'transcript')
    .eq('processed', false)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SyncRow<TranscriptPayload>[];
}

/** Marque une transcription comme traitée (succès ou échec, pour ne pas boucler dessus). */
export async function markTranscriptProcessed(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('sync_queue').update({ processed: true }).eq('id', id);
}

/** Dépose le résultat d'une extraction, pour que les autres appareils l'ajoutent à leur journal. */
export async function pushEntry(device: string, entry: EntryPayload): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('sync_queue')
    .insert({ device, kind: 'entry', payload: entry, processed: true });
  if (error) throw new Error(error.message);
}

/** Entrées traitées par d'AUTRES appareils, déposées après le curseur temporel donné. */
export async function fetchNewEntries(device: string, after: string | null): Promise<SyncRow<EntryPayload>[]> {
  if (!supabase) return [];
  let query = supabase
    .from('sync_queue')
    .select('*')
    .eq('kind', 'entry')
    .neq('device', device)
    .order('created_at', { ascending: true });
  if (after) query = query.gt('created_at', after);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as SyncRow<EntryPayload>[];
}
