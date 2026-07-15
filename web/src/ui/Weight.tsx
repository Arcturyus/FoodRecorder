import { useState } from 'react';
import { WeightCapture } from './WeightCapture';
import { WeightForm } from './WeightForm';
import { WeightChart } from './WeightChart';
import { WeightHistory } from './WeightHistory';
import type { WeightPatch } from '../extraction/weight';

/**
 * Onglet Poids : dictée/analyse d'une pesée → pré-remplissage du formulaire →
 * enregistrement, puis courbe d'évolution et historique éditable.
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
    </>
  );
}
