import { useState } from 'react';
import { ProfilePanel } from './ProfilePanel';
import { ProfileSyncPanel } from './ProfileSync';
import { WeightCapture } from './WeightCapture';
import { WeightForm } from './WeightForm';
import { WeightChart } from './WeightChart';
import { WeightHistory } from './WeightHistory';
import type { WeightPatch } from '../extraction/weight';

/**
 * Onglet « Profil » : tout ce qui vous concerne, vous. Le profil (sexe, poids,
 * activité, objectif) qui pilote les cibles, la connexion au compte de synchro,
 * puis les pesées qui alimentent le poids — dictée/analyse d'une pesée →
 * pré-remplissage du formulaire → enregistrement, courbe et historique éditable.
 */
export function Weight() {
  const [prefill, setPrefill] = useState<{ patch: WeightPatch; nonce: number } | null>(null);
  const [focusEntry, setFocusEntry] = useState<{ id: string; nonce: number } | null>(null);

  return (
    <>
      <ProfilePanel />
      <ProfileSyncPanel />
      <WeightCapture onExtract={(patch) => setPrefill({ patch, nonce: Date.now() })} />
      <WeightForm prefill={prefill} />
      <WeightChart onEditEntry={(id) => setFocusEntry({ id, nonce: Date.now() })} />
      <WeightHistory focusEntry={focusEntry} />
    </>
  );
}
