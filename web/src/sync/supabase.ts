import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ExtractedItem } from '../nutrition/types';
import type { SunExposure } from '../sun/vitaminD';

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

export interface ImagePayload {
  /** Image réduite, en base64 nu (sans préfixe data:…). */
  imageBase64: string;
  mediaType: string;
  date?: string;
}

export interface EntryPayload {
  transcript: string;
  items: ExtractedItem[];
  source: 'claudecode';
  date?: string;
}

/** Une sortie au soleil prête à enregistrer (l'id et l'horodatage sont locaux). */
export type SunPayloadExposure = Omit<SunExposure, 'id' | 'createdAt'>;

/** Résultat d'une dictée soleil analysée, à rejouer sur les autres appareils. */
export interface SunEntryPayload {
  transcript: string;
  sorties: SunPayloadExposure[];
}

/** Kinds déposés dans la file : dictées/photos en attente, et résultats traités. */
export type SyncKind = 'transcript' | 'image' | 'entry' | 'sun' | 'sun-entry';

/** Kinds « résultat » que les autres appareils rejouent dans leur journal. */
export const RESULT_KINDS = ['entry', 'sun-entry'] as const;

interface SyncRow<T> {
  id: string;
  device: string;
  kind: SyncKind;
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

/** Dépose une photo (réduite) en attente d'analyse par un autre appareil. */
export async function pushImage(device: string, imageBase64: string, mediaType: string, date?: string): Promise<void> {
  if (!supabase) return;
  const payload: ImagePayload = { imageBase64, mediaType, ...(date ? { date } : {}) };
  const { error } = await supabase
    .from('sync_queue')
    .insert({ device, kind: 'image', payload, processed: false });
  if (error) throw new Error(error.message);
}

/** Lignes en attente d'un kind donné (tous appareils confondus), plus anciennes d'abord. */
async function fetchPending<T>(kind: SyncKind): Promise<SyncRow<T>[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('sync_queue')
    .select('*')
    .eq('kind', kind)
    .eq('processed', false)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as SyncRow<T>[];
}

/** Récupère les transcriptions en attente (tous appareils confondus). */
export function fetchPendingTranscripts(): Promise<SyncRow<TranscriptPayload>[]> {
  return fetchPending<TranscriptPayload>('transcript');
}

/** Récupère les photos en attente (tous appareils confondus). */
export function fetchPendingImages(): Promise<SyncRow<ImagePayload>[]> {
  return fetchPending<ImagePayload>('image');
}

/** Récupère les dictées « soleil » en attente d'analyse. */
export function fetchPendingSun(): Promise<SyncRow<TranscriptPayload>[]> {
  return fetchPending<TranscriptPayload>('sun');
}

/** Dépose une dictée « soleil » en attente d'analyse par un autre appareil. */
export async function pushSunTranscript(device: string, transcript: string, date?: string): Promise<void> {
  if (!supabase) return;
  const payload: TranscriptPayload = { transcript, ...(date ? { date } : {}) };
  const { error } = await supabase.from('sync_queue').insert({ device, kind: 'sun', payload, processed: false });
  if (error) throw new Error(error.message);
}

/** Dépose des sorties au soleil analysées, pour que les autres appareils les rejouent. */
export async function pushSunEntry(device: string, entry: SunEntryPayload): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from('sync_queue')
    .insert({ device, kind: 'sun-entry', payload: entry, processed: true });
  if (error) throw new Error(error.message);
}

/** Marque une ligne en attente (transcription ou photo) comme traitée, pour ne pas boucler dessus. */
export async function markProcessed(id: string): Promise<void> {
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

/** Une ligne de résultat à rejouer : repas (`entry`) ou sorties au soleil (`sun-entry`). */
export type ResultRow =
  | (SyncRow<EntryPayload> & { kind: 'entry' })
  | (SyncRow<SunEntryPayload> & { kind: 'sun-entry' });

/**
 * Résultats traités par d'AUTRES appareils, déposés après le curseur temporel
 * donné — repas ET sorties au soleil confondus, dans l'ordre chronologique.
 * Les deux kinds partagent le même curseur : les lire ensemble évite qu'un
 * repas récent ne fasse sauter une sortie soleil plus ancienne (et inversement).
 */
export async function fetchNewEntries(device: string, after: string | null): Promise<ResultRow[]> {
  if (!supabase) return [];
  let query = supabase
    .from('sync_queue')
    .select('*')
    .in('kind', RESULT_KINDS as unknown as string[])
    .neq('device', device)
    .order('created_at', { ascending: true });
  if (after) query = query.gt('created_at', after);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as ResultRow[];
}
