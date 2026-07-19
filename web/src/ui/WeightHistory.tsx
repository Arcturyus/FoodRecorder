import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, todayStr } from '../store/store';
import { computeWeight } from '../weight/compute';
import { WEIGHT_METRICS } from '../weight/types';
import type { WeightEntry, WeightMetricKey } from '../weight/types';
import { fmt } from './format';
import { NumberField } from './NumberField';

/**
 * Historique des pesées : liste chronologique (plus récent en premier), avec
 * édition en place de chaque champ et suppression. Les champs dérivés sont
 * affichés (lecture seule) sous chaque pesée dépliée.
 *
 * `focusEntry` (venant d'un clic sur un point du graphe) ouvre et scrolle
 * automatiquement vers la ligne correspondante.
 */
export function WeightHistory({ focusEntry }: { focusEntry?: { id: string; nonce: number } | null }) {
  const entries = useStore((s) => s.weightEntries);
  const sorted = useMemo(
    () => [...entries].sort((a, b) => `${b.date} ${b.heure}`.localeCompare(`${a.date} ${a.heure}`)),
    [entries],
  );

  return (
    <div className="panel">
      <h2>Historique ({sorted.length})</h2>
      {sorted.length === 0 ? (
        <div className="empty">Aucune pesée enregistrée.</div>
      ) : (
        sorted.map((e) => (
          <WeightRow key={e.id} entry={e} focus={focusEntry && focusEntry.id === e.id ? focusEntry.nonce : undefined} />
        ))
      )}
    </div>
  );
}

function toNum(s: string): number | undefined {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function WeightRow({ entry, focus }: { entry: WeightEntry; focus?: number }) {
  const updateWeightEntry = useStore((s) => s.updateWeightEntry);
  const removeWeightEntry = useStore((s) => s.removeWeightEntry);
  const weightConfig = useStore((s) => s.weightConfig);
  const sexe = useStore((s) => s.profile.sexe);
  const [editing, setEditing] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus == null) return;
    setEditing(true);
    rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus]);

  const computed = computeWeight(
    { poids: entry.poids, masseMusculaire: entry.masseMusculaire },
    weightConfig,
    sexe,
  );
  const dateLabel = new Date(`${entry.date}T00:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const setNum = (key: WeightMetricKey, v: string) =>
    updateWeightEntry(entry.id, { [key]: key === 'poids' ? toNum(v) ?? entry.poids : toNum(v) });

  return (
    <div ref={rowRef} className="entry-card" style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
      <div className="entry-meta">
        <span>
          <strong style={{ textTransform: 'capitalize' }}>{dateLabel}</strong> · {entry.heure} ·{' '}
          <strong>{fmt(entry.poids, 1)} kg</strong>
          {entry.masseGrasse != null && <> · {fmt(entry.masseGrasse, 1)} % MG</>}
          {(entry.aJeun || entry.nu) && (
            <span className="small"> · {[entry.aJeun && 'à jeun', entry.nu && 'nu'].filter(Boolean).join(', ')}</span>
          )}
        </span>
        <div className="row">
          <button className="ghost small" onClick={() => setEditing((v) => !v)}>
            {editing ? 'Terminer' : 'Modifier'}
          </button>
          <button
            className="danger small"
            onClick={() => window.confirm(`Supprimer la pesée du ${dateLabel} (${fmt(entry.poids, 1)} kg) ?`) && removeWeightEntry(entry.id)}
          >
            Suppr.
          </button>
        </div>
      </div>

      {entry.remarque && !editing && <div className="entry-transcript">« {entry.remarque} »</div>}

      {editing && (
        <>
          <div className="row wrap-form" style={{ marginTop: 8 }}>
            <label className="field">
              Date
              <input
                type="date"
                value={entry.date}
                max={todayStr()}
                onChange={(e) => e.target.value && updateWeightEntry(entry.id, { date: e.target.value })}
              />
            </label>
            <label className="field" style={{ flex: '0 0 110px' }}>
              Heure
              <input type="time" value={entry.heure} onChange={(e) => updateWeightEntry(entry.id, { heure: e.target.value })} />
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
              <input type="checkbox" checked={entry.aJeun} onChange={(e) => updateWeightEntry(entry.id, { aJeun: e.target.checked })} style={{ width: 'auto' }} />
              À jeun
            </label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
              <input type="checkbox" checked={entry.nu} onChange={(e) => updateWeightEntry(entry.id, { nu: e.target.checked })} style={{ width: 'auto' }} />
              Nu
            </label>
          </div>
          <div className="row wrap-form" style={{ marginTop: 8 }}>
            {WEIGHT_METRICS.map((mt) => (
              <label className="field" key={mt.key} style={{ flex: '1 1 120px' }}>
                {mt.label}
                {mt.unit ? ` (${mt.unit})` : ''}
                <NumberField step={0.1} value={entry[mt.key] ?? ''} onChange={(v) => setNum(mt.key, v)} />
              </label>
            ))}
          </div>
          <label className="field" style={{ marginTop: 8 }}>
            Note
            <input
              type="text"
              value={entry.remarque ?? ''}
              onChange={(e) => updateWeightEntry(entry.id, { remarque: e.target.value || undefined })}
            />
          </label>
        </>
      )}

      <div className="hint" style={{ marginTop: 8 }}>
        IMC {fmt(computed.imc, 2)}
        {computed.masseMusculaireSquelettique != null && <> · MM squelettique {fmt(computed.masseMusculaireSquelettique, 2)} kg</>}
        {' '}· BMR HB {fmt(computed.bmrHarrisBenedict)} · MSJ {fmt(computed.bmrMifflinStJeor)} kcal · avec activité HB{' '}
        {fmt(computed.tmaHB)} / MSJ {fmt(computed.tmaMSJ)} kcal
      </div>
    </div>
  );
}
