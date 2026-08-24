import { useState } from 'react';
import { ProfilePanel } from './ProfilePanel';
import { EnergyPanel } from './EnergyPanel';
import { WeightCapture } from './WeightCapture';
import { WeightForm } from './WeightForm';
import { WeightChart } from './WeightChart';
import { WeightHistory } from './WeightHistory';
import type { WeightPatch } from '../extraction/weight';

/**
 * Onglet « Poids ». L'ordre suit ce qu'on vient y faire : d'abord ENREGISTRER une
 * pesée (dictée ou formulaire), puis la voir dans la courbe, puis — rarement —
 * relire l'historique ou retoucher le profil qui pilote les cibles.
 *
 * L'onglet s'appelait « Profil » et s'ouvrait sur le formulaire de profil : un
 * réglage qu'on modifie deux fois par an occupait le premier écran, devant le
 * geste quotidien. Les trois panneaux de bas de page sont repliés par défaut
 * (cf. `Section`) ; la synchro cloud, qui est un réglage et non une donnée
 * corporelle, est passée en tête de l'onglet Réglages.
 */
export function Weight() {
  const [prefill, setPrefill] = useState<{ patch: WeightPatch; nonce: number } | null>(null);
  const [focusEntry, setFocusEntry] = useState<{ id: string; nonce: number } | null>(null);

  return (
    <>
      <WeightCapture onExtract={(patch) => setPrefill({ patch, nonce: Date.now() })} />
      <WeightForm prefill={prefill} />
      <WeightChart onEditEntry={(id) => setFocusEntry({ id, nonce: Date.now() })} />
      <WeightHistory focusEntry={focusEntry} />
      <ProfilePanel />
      <EnergyPanel />
    </>
  );
}
