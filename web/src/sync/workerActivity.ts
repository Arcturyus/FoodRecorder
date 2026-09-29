import type { SyncKind } from './supabase';

/** A compact, prompt-free summary of work completed by the local background worker. */
export interface BackgroundWorkerActivity {
  loggedAt: string;
  kind: SyncKind;
  status: 'success' | 'error';
  captureDate: string | null;
  clientTime: string | number | null;
  durationMs: number;
  source?: string;
  /** Present only for transcription-based queue items, never for image captures. */
  transcript?: string;
  mediaType?: string;
  result?: unknown;
  error?: string;
}

export type BackgroundActivityReporter = (activity: BackgroundWorkerActivity) => void;
