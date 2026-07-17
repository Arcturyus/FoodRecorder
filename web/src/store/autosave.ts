/**
 * Sauvegarde automatique quotidienne sur le disque.
 *
 * Toutes les données vivent dans le localStorage : un nettoyage du navigateur,
 * un changement d'appareil ou un mode privé, et l'historique disparaît. À la
 * première ouverture de la journée, on dépose donc un JSON complet dans
 * `save/` à la racine du dépôt, via le middleware de dev (vite-plugin-save.ts).
 *
 * Ne marche que sous `npm run dev` (le middleware n'existe pas ailleurs) :
 * partout ailleurs, c'est un no-op silencieux et l'export manuel des Réglages
 * reste la voie.
 */

import { useStore, todayStr } from './store';
import { buildBackup } from './backup';

/** Résultat d'un tick, pour l'affichage éventuel et les tests. */
export type AutoSaveResult =
  | { status: 'written'; file: string }
  | { status: 'already-done' }
  | { status: 'unavailable' };

/**
 * Garde-fou anti-concurrence (même principe que `runSyncTick`) : le marqueur du
 * jour n'est posé qu'après l'écriture, donc deux appels rapprochés — React
 * StrictMode monte les effets deux fois en dev — partiraient tous les deux.
 */
let running = false;

/**
 * Écrit la sauvegarde du jour si elle n'a pas déjà été faite. Silencieux et sans
 * effet si l'endpoint n'existe pas (site déployé) ou si le réseau échoue :
 * une sauvegarde ratée ne doit jamais gêner l'utilisation de l'app.
 */
export async function runAutoSaveTick(): Promise<AutoSaveResult> {
  const { lastAutoSave, setLastAutoSave } = useStore.getState();
  const today = todayStr();
  if (lastAutoSave === today || running) return { status: 'already-done' };
  running = true;

  try {
    const health = await fetch('/api/save');
    if (!health.ok) return { status: 'unavailable' };

    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBackup(), null, 2),
    });
    const data = (await res.json().catch(() => ({}))) as { written?: string; error?: string };
    if (!res.ok || !data.written) return { status: 'unavailable' };

    // Marqué seulement après une écriture confirmée : un échec doit être retenté
    // à la prochaine ouverture, pas considéré comme fait.
    setLastAutoSave(today);
    return { status: 'written', file: data.written };
  } catch {
    return { status: 'unavailable' };
  } finally {
    running = false;
  }
}
