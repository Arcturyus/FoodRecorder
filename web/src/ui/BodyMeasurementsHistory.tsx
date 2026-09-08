import { useMemo, useState } from 'react';
import { useStore, todayStr } from '../store/store';
import { BODY_MEASUREMENT_FIELDS } from '../weight/types';
import type { BodyMeasurementEntry } from '../weight/types';
import { fmt } from './format';
import { NumberField } from './NumberField';
import { Section } from './Section';

type MeasurementKey = typeof BODY_MEASUREMENT_FIELDS[number]['key'];

function toNumber(value: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Historique séparé : les mensurations sont rares et ne doivent pas alourdir les pesées. */
export function BodyMeasurementsHistory() {
  const entries = useStore((s) => s.bodyMeasurements);
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [entries],
  );
  const last = sorted[0];

  return (
    <Section
      id="mensurations-historique"
      title={`Historique des mensurations (${sorted.length})`}
      defaultOpen={false}
      summary={last ? `dernières : ${new Date(`${last.date}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : 'aucune mensuration'}
    >
      {sorted.length === 0 ? <div className="empty">Aucune mensuration enregistrée.</div> : sorted.map((entry) => <MeasurementRow key={entry.id} entry={entry} />)}
    </Section>
  );
}

function MeasurementRow({ entry }: { entry: BodyMeasurementEntry }) {
  const update = useStore((s) => s.updateBodyMeasurement);
  const remove = useStore((s) => s.removeBodyMeasurement);
  const [editing, setEditing] = useState(false);
  const dateLabel = new Date(`${entry.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const highlights = BODY_MEASUREMENT_FIELDS
    .filter(({ key }) => entry[key] != null)
    .slice(0, 3)
    .map(({ key, label }) => `${label.toLowerCase()} ${fmt(entry[key]!, 1)} cm`);

  function setNumber(key: MeasurementKey, value: string) {
    update(entry.id, { [key]: toNumber(value) } as Partial<BodyMeasurementEntry>);
  }

  return (
    <div className="entry-card" style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10 }}>
      <div className="entry-meta">
        <span><strong style={{ textTransform: 'capitalize' }}>{dateLabel}</strong>{highlights.length ? ` · ${highlights.join(' · ')}` : ''}</span>
        <div className="row">
          <button className="ghost small" onClick={() => setEditing((value) => !value)}>{editing ? 'Masquer' : 'Modifier'}</button>
          <button className="danger small" onClick={() => window.confirm(`Supprimer les mensurations du ${dateLabel} ?`) && remove(entry.id)}>Suppr.</button>
        </div>
      </div>
      {entry.measurementProtocol && !editing && <div className="entry-transcript">{entry.measurementProtocol}</div>}
      {editing && (
        <>
          <div className="row wrap-form" style={{ marginTop: 8 }}>
            <label className="field">Date<input type="date" value={entry.date} max={todayStr()} onChange={(event) => event.target.value && update(entry.id, { date: event.target.value })} /></label>
            <label className="field" style={{ flex: '2 1 260px' }}>Protocole<input value={entry.measurementProtocol ?? ''} onChange={(event) => update(entry.id, { measurementProtocol: event.target.value || undefined })} /></label>
          </div>
          <div className="row wrap-form" style={{ marginTop: 8 }}>
            {BODY_MEASUREMENT_FIELDS.map(({ key, label }) => (
              <label className="field" key={key} style={{ flex: '1 1 150px' }}>
                {label} (cm)
                <NumberField min={0} step={0.1} value={entry[key] ?? ''} onChange={(value) => setNumber(key, value)} />
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
