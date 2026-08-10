/**
 * État de la synchronisation par profil, persisté À PART du store principal
 * (clé `foodrecorder-sync-v1`) pour ne jamais polluer les données ni le backup
 * JSON. Contient : le profil joint (id stable + nom), l'ensemble des
 * modifications locales en attente de push (`pending`, par `table:id`), le
 * curseur de pull (dernier `synced_at` serveur vu), et un peu d'état d'affichage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Une modification locale à pousser. `deleted` = tombstone (ligne supprimée). */
export interface PendingChange {
  /** Horodatage local de la modification (epoch ms) → arbitrage last-write-wins. */
  updatedAt: number;
  deleted?: boolean;
}

interface SyncState {
  profileId: string | null;
  profileName: string | null;
  /**
   * Session Supabase perdue (jeton de rafraîchissement expiré, ou déconnexion côté serveur) : le
   * profil est toujours connu — son nom reste affichable — mais la synchro est suspendue jusqu'à
   * ressaisie du mot de passe. Le jeton lui-même n'est pas stocké ici : supabase-js le persiste et
   * le rafraîchit dans son coin.
   */
  sessionExpired: boolean;
  /** Modifications en attente de push, par clé `table:id`. */
  pending: Record<string, PendingChange>;
  /** Dernier `synced_at` serveur appliqué (curseur de pull incrémental). */
  pullCursor: string | null;
  lastSyncAt: number | null;
  lastError: string | null;

  /** Connexion réussie (création ou jonction) : réinitialise pending + curseur. */
  setSession: (id: string, name: string) => void;
  /**
   * Session rétablie après expiration. Distinct de `setSession`, qui repart de zéro : ici il FAUT
   * préserver `pending` et le curseur, sinon les modifications faites pendant l'expiration seraient
   * perdues sans jamais être poussées.
   */
  renewSession: () => void;
  /** Met à jour le seul nom affiché (après un renommage) sans toucher pending/curseur. */
  setProfileName: (name: string) => void;
  /** Session perdue : garde le profil affiché, suspend la synchro. */
  setSessionExpired: () => void;
  /** Quitte complètement le profil (déconnexion explicite). */
  clearSession: () => void;
  /** Fusionne des modifications dans `pending` (dernier gagne par clé). */
  mergePending: (changes: Record<string, PendingChange>) => void;
  /** Retire de `pending` les clés poussées dont l'horodatage n'a pas bougé. */
  clearPushed: (keys: string[], expected: Record<string, PendingChange>) => void;
  setCursor: (cursor: string | null) => void;
  setSynced: (at: number) => void;
  setError: (message: string | null) => void;
}

export const useSyncStore = create<SyncState>()(
  persist(
    (set) => ({
      profileId: null,
      profileName: null,
      sessionExpired: false,
      pending: {},
      pullCursor: null,
      lastSyncAt: null,
      lastError: null,

      setSession: (id, name) =>
        set({
          profileId: id,
          profileName: name,
          sessionExpired: false,
          pending: {},
          pullCursor: null,
          lastError: null,
        }),

      renewSession: () => set({ sessionExpired: false, lastError: null }),

      setProfileName: (name) => set({ profileName: name }),

      setSessionExpired: () => set({ sessionExpired: true }),

      clearSession: () =>
        set({
          profileId: null,
          profileName: null,
          sessionExpired: false,
          pending: {},
          pullCursor: null,
          lastError: null,
        }),

      mergePending: (changes) =>
        set((s) => ({ pending: { ...s.pending, ...changes } })),

      clearPushed: (keys, expected) =>
        set((s) => {
          const pending = { ...s.pending };
          for (const k of keys) {
            // Ne retirer que si l'entrée n'a pas été re-modifiée pendant le push.
            if (pending[k] && expected[k] && pending[k].updatedAt === expected[k].updatedAt) delete pending[k];
          }
          return { pending };
        }),

      setCursor: (cursor) => set({ pullCursor: cursor }),
      setSynced: (at) => set({ lastSyncAt: at, lastError: null }),
      setError: (message) => set({ lastError: message }),
    }),
    { name: 'foodrecorder-sync-v1' },
  ),
);
