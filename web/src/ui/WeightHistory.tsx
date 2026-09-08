import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, todayStr } from '../store/store';
import { computeWeight } from '../weight/compute';
import { WEIGHT_METRICS } from '../weight/types';
import type { WeightEntry, WeightMetricKey } from '../weight/types';
import { fmt } from './format';
import { NumberField } from './NumberField';
import { Section } from './Section';

/** Pesées montrées d'emblée ; le reste au clic. */
const ROWS_SHOWN = 10;

/**
 * Historique des pesées : liste chronologique (plus récent en premier), avec
 * édition en place de chaque champ et suppression.
 *
 * Replié par défaut et borné aux dix dernières pesées : à 38 pesées la liste
 * faisait déjà 3 058 px, et elle grandit d'une ligne par jour. Une ligne ne
 * porte plus que la date, le poids et la masse grasse ; les valeurs calculées
 * (IMC, métabolismes) sont dans le dépli, avec les champs modifiables.
 *
 * `focusEntry` (venant d'un clic sur un point du graphe) déplie la section,
 * remonte la limite si la pesée visée est au-delà, puis ouvre et scrolle vers
 * sa ligne — sinon le clic sur la courbe ne mènerait nulle part.
 */
export function WeightHistory({ focusEntry }: { focusEntry?: { id: string; nonce: number } | null }) {
  const entries = useStore((s) => s.weightEntries);
  const [showAll, setShowAll] = useState(false);
  const sorted = useMemo(
    () => [...entries].sort((a, b) => `${b.date} ${b.heure}`.localeCompare(`${a.date} ${a.heure}`)),
    [entries],
  );

  const focusIndex = focusEntry ? sorted.findIndex((e) => e.id === focusEntry.id) : -1;
  useEffect(() => {
    if (focusIndex >= ROWS_SHOWN) setShowAll(true);
  }, [focusIndex, focusEntry?.nonce]);

  const shown = showAll ? sorted : sorted.slice(0, ROWS_SHOWN);
  const last = sorted[0];

  return (
    <Section
      id="pesees"
      title={`Historique (${sorted.length})`}
      defaultOpen={false}
      openSignal={focusEntry?.nonce}
      summary={
        last
          ? `dernière : ${fmt(last.poids, 1)} kg le ${new Date(`${last.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
          : 'aucune pesée'
      }
    >
      {sorted.length === 0 ? (
        <div className="empty">Aucune pesée enregistrée.</div>
      ) : (
        <>
          {shown.map((e) => (
            <WeightRow key={e.id} entry={e} focus={focusEntry && focusEntry.id === e.id ? focusEntry.nonce : undefined} />
          ))}
          {!showAll && sorted.length > ROWS_SHOWN && (
            <button className="ghost small" style={{ marginTop: 10 }} onClick={() => setShowAll(true)}>
              Voir les {sorted.length - ROWS_SHOWN} pesée(s) plus anciennes
            </button>
          )}
        </>
      )}
    </Section>
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
            {editing ? 'Masquer' : 'Détails'}
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

          {/* Valeurs calculées à partir de la pesée — dans le dépli : elles
              doublaient la hauteur de CHAQUE ligne de la liste. */}
          <div className="hint" style={{ marginTop: 8 }}>
            IMC {fmt(computed.imc, 2)}
            {computed.masseMusculaireSquelettique != null && <> · MM squelettique {fmt(computed.masseMusculaireSquelettique, 2)} kg</>}
          {' '}· BMR HB {fmt(computed.bmrHarrisBenedict)} · MSJ {fmt(computed.bmrMifflinStJeor)} kcal
          </div>
        </>
      )}
    </div>
  );
}
