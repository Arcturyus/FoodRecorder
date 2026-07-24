import { useState } from 'react';
import { useStore } from '../store/store';

/**
 * Note libre rattachée à un jour (ex. « coup de soleil torse et dos »). Purement
 * informatif : aucun impact sur les moyennes/stats. État local pour la frappe,
 * commit trimmé au blur (le trim en continu casserait la saisie d'espaces).
 *
 * `date` doit rester stable pendant que le champ est monté (sinon passer une
 * `key={date}` au parent pour réinitialiser le texte à l'ouverture d'un autre jour).
 */
export function DayNote({ date }: { date: string }) {
  const stored = useStore((s) => s.dayNotes[date] ?? '');
  const setDayNote = useStore((s) => s.setDayNote);
  const [text, setText] = useState(stored);

  return (
    <div className="panel">
      <label className="field">
        📝 Note du jour
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setDayNote(date, text)}
          rows={2}
          style={{ resize: 'vertical' }}
          placeholder="Un mémo sur cette journée (ex. « coup de soleil torse et dos », nuit courte, courbatures…)"
          aria-label="Note libre du jour"
        />
      </label>
      <div className="hint">Note personnelle, sans effet sur les moyennes ni les calculs.</div>
    </div>
  );
}
