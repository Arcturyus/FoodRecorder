import { useState } from 'react';
import { useStore, todayStr } from '../store/store';
import { BODY_MEASUREMENT_FIELDS } from '../weight/types';
import type { BodyMeasurementEntry } from '../weight/types';
import { NumberField } from './NumberField';
import { SuggestedNumberField } from './SuggestedNumberField';

type MeasurementKey = typeof BODY_MEASUREMENT_FIELDS[number]['key'];
type Draft = Record<MeasurementKey, string>;

const emptyDraft = (): Draft => Object.fromEntries(BODY_MEASUREMENT_FIELDS.map(({ key }) => [key, ''])) as Draft;

function toNumber(value: string): number | undefined {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** Déplié seulement à la demande : les mensurations sont beaucoup moins fréquentes qu'une pesée. */
export function BodyMeasurements() {
  const addBodyMeasurement = useStore((s) => s.addBodyMeasurement);
  const bodyMeasurements = useStore((s) => s.bodyMeasurements);
  const weightConfig = useStore((s) => s.weightConfig);
  const setWeightConfig = useStore((s) => s.setWeightConfig);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayStr());
  const [protocol, setProtocol] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [flash, setFlash] = useState('');
  const [acceptedFields, setAcceptedFields] = useState<Set<MeasurementKey>>(() => new Set());
  const lastMeasurement = [...bodyMeasurements].sort((a, b) => a.createdAt - b.createdAt).at(-1);

  function set(key: MeasurementKey, value: string) {
    setAcceptedFields((current) => new Set(current).add(key));
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const values = Object.fromEntries(
      BODY_MEASUREMENT_FIELDS
        .map(({ key }) => [key, toNumber(draft[key])] as const)
        .filter(([, value]) => value != null),
    ) as Partial<Pick<BodyMeasurementEntry, MeasurementKey>>;
    if (Object.values(values).every((value) => value == null)) return;
    addBodyMeasurement({ date, measurementProtocol: protocol.trim() || undefined, ...values });
    setFlash('Mensurations enregistrées.');
    setDraft(emptyDraft());
    setProtocol('');
    setAcceptedFields(new Set());
  }

  return (
    <div style={{ margin: '-2px 0 12px' }}>
      <button className="ghost small" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        📏 {open ? 'Masquer les mensurations' : 'Ajouter des mensurations'}
      </button>
      {open && (
        <div className="panel" style={{ marginTop: 8 }} data-agent-section="mensurations">
          <h2>Mensurations corporelles</h2>
          <p className="small" style={{ marginTop: -6 }}>Ajoute tes mensurations. Taille et âge servent aux calculs ; les tours sont tous optionnels.</p>
          <div className="row wrap-form">
            <label className="field">
              Taille (cm) *
              <NumberField min={120} max={230} step={1} value={Math.round(weightConfig.taille * 100)} onChange={(value) => { const cm = toNumber(value); if (cm != null && cm >= 120 && cm <= 230) setWeightConfig({ taille: cm / 100 }); }} />
            </label>
            <label className="field">
              Âge (ans) *
              <NumberField min={10} max={100} step={1} value={weightConfig.age} onChange={(value) => { const age = toNumber(value); if (age != null && age >= 10 && age <= 100) setWeightConfig({ age }); }} />
            </label>
          </div>
          <div className="row wrap-form">
            <label className="field"><span>Date</span><input type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
            <label className="field" style={{ flex: '2 1 260px' }}><span>Protocole (optionnel)</span><input value={protocol} placeholder="ex. matin, à jeun, relâché" onChange={(e) => setProtocol(e.target.value)} /></label>
          </div>
          <div className="row wrap-form" style={{ marginTop: 8 }}>
            {BODY_MEASUREMENT_FIELDS.map(({ key, label }) => (
              <label className="field" key={key} style={{ flex: '1 1 150px' }}>
                {label} (cm)
                <SuggestedNumberField
                  min={0}
                  step={0.1}
                  value={draft[key]}
                  suggestedValue={lastMeasurement?.[key]}
                  accepted={acceptedFields.has(key)}
                  onAccept={() => setAcceptedFields((current) => new Set(current).add(key))}
                  onChange={(value) => set(key, value)}
                />
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}><button className="primary" onClick={save}>Enregistrer les mensurations</button></div>
          {flash && <div className="status" style={{ marginTop: 8 }}>{flash}</div>}
        </div>
      )}
    </div>
  );
}
