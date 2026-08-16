/**
 * État d'avancement de la file de traitement (`sync_queue`), publié par le poller
 * et lu par le bandeau de l'onglet du jour.
 *
 * Volontairement NON persisté, contrairement à `useSyncStore` : c'est une photo de
 * l'instant, qui n'a rien à faire ni dans le localStorage ni dans le backup JSON.
 * Le compteur de traitées repart donc de zéro à chaque rechargement — et, plus
 * souvent, à chaque fois qu'on quitte l'onglet du jour et qu'on y revient
 * (le bandeau appelle `reset` à son montage).
 */

import { create } from 'zustand';
import type { PendingItem, SyncKind } from './supabase';

/** Une ligne traitée sans résultat exploitable, avec le motif à afficher. */
export interface QueueFailure {
  kind: SyncKind;
  message: string;
}

/** Ce que le pont de CE poste est en train d'analyser (`index`-ième sur `total`). */
export interface QueueCurrent {
  kind: SyncKind;
  index: number;
  total: number;
}

export type PendingCounts = Record<SyncKind, number>;

export const NO_PENDING: PendingCounts = { transcript: 0, image: 0, sun: 0, weight: 0 };

export function pendingTotal(counts: PendingCounts): number {
  return counts.transcript + counts.image + counts.sun + counts.weight;
}

interface QueueStatusState {
  /** Lignes encore en attente, telles que connues au dernier tick. */
  pending: PendingCounts;
  /**
   * Les mêmes lignes, une par une (kind, heure d'envoi, texte dicté) : de quoi déplier
   * le bandeau pour savoir CE QUI attend, et pas seulement combien.
   */
  pendingItems: PendingItem[];
  /** Analyse en cours sur ce poste, ou `null` (rien en cours, ou pas de pont ici). */
  current: QueueCurrent | null;
  /**
   * Ce poste a le pont Claude Code disponible : c'est LUI qui vide la file. Sinon il
   * ne peut qu'annoncer l'attente, sans savoir si l'ordinateur mouline ou est éteint.
   */
  hasBridge: boolean;
  /** Lignes traitées avec un résultat, depuis la dernière remise à zéro. */
  done: number;
  /** Lignes traitées sans résultat (erreur CLI, photo illisible, dictée vide). */
  failures: QueueFailure[];

  /** Compte et détail vont toujours ensemble : un seul setter, impossible de les désynchroniser. */
  setPending: (pending: PendingCounts, items: PendingItem[]) => void;
  setCurrent: (current: QueueCurrent | null) => void;
  setBridge: (hasBridge: boolean) => void;
  recordDone: () => void;
  recordFailure: (failure: QueueFailure) => void;
  /** Remet à zéro le bilan de session (traitées/échecs), pas l'attente en cours. */
  reset: () => void;
}

export const useQueueStatus = create<QueueStatusState>()((set) => ({
  pending: NO_PENDING,
  pendingItems: [],
  current: null,
  hasBridge: false,
  done: 0,
  failures: [],

  setPending: (pending, pendingItems) => set({ pending, pendingItems }),
  setCurrent: (current) => set({ current }),
  setBridge: (hasBridge) => set({ hasBridge }),
  recordDone: () => set((s) => ({ done: s.done + 1 })),
  recordFailure: (failure) => set((s) => ({ failures: [...s.failures, failure] })),
  reset: () => set({ done: 0, failures: [] }),
}));
