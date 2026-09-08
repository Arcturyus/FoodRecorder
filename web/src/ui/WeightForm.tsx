import { useEffect, useMemo, useState } from 'react';
import { useStore, todayStr, nowTime } from '../store/store';
import { computeWeight } from '../weight/compute';
import { WEIGHT_METRICS } from '../weight/types';
import type { WeightEntry, WeightMetricKey } from '../weight/types';
import type { WeightPatch } from '../extraction/weight';
import { fmt } from './format';
import { SuggestedNumberField } from './SuggestedNumberField';

/** Champs numériques saisissables (poids requis en tête). */
const NUM_FIELDS = WEIGHT_METRICS; // même ordre que le CSV

type Draft = Record<WeightMetricKey, string>;

const EMPTY_DRAFT: Draft = {
  poids: '',
  masseGrasse: '',
  eau: '',
  masseMusculaire: '',
  masseOsseuse: '',
  graisseViscerale: '',
  metabolismeBasalMachine: '',
};

function toNum(s: string): number | undefined {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Formulaire d'enregistrement d'une pesée. `prefill` (issu de la dictée/LLM)
 * pré-remplit les champs quand son `nonce` change. Affiche en direct les
 * champs dérivés et permet d'éditer les constantes personnelles.
 */
export function WeightForm({ prefill }: { prefill?: { patch: WeightPatch; nonce: number } | null }) {
  const addWeightEntry = useStore((s) => s.addWeightEntry);
  const weightEntries = useStore((s) => s.weightEntries);
  const weightConfig = useStore((s) => s.weightConfig);
  const sexe = useStore((s) => s.profile.sexe);

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [date, setDate] = useState(todayStr());
  const [heure, setHeure] = useState(nowTime());
  const [aJeun, setAJeun] = useState(true);
  const [nu, setNu] = useState(true);
  const [remarque, setRemarque] = useState('');
  const [flash, setFlash] = useState('');
  const [acceptedFields, setAcceptedFields] = useState<Set<WeightMetricKey>>(() => new Set());

  const lastWeight = useMemo(
    () => [...weightEntries].sort((a, b) => `${a.date} ${a.heure}`.localeCompare(`${b.date} ${b.heure}`)).at(-1),
    [weightEntries],
  );

  // Applique un pré-remplissage venant de la dictée.
  useEffect(() => {
    if (!prefill) return;
    const p = prefill.patch;
    setDraft((d) => {
      const next = { ...d };
      for (const { key } of NUM_FIELDS) {
        const v = p[key];
        if (v != null) next[key] = String(v);
      }
      return next;
    });
    setAcceptedFields((current) => new Set([...current, ...NUM_FIELDS.filter(({ key }) => p[key] != null).map(({ key }) => key)]));
    if (p.aJeun != null) setAJeun(p.aJeun);
    if (p.nu != null) setNu(p.nu);
    if (p.date && p.date <= todayStr()) setDate(p.date);
    if (p.heure) setHeure(p.heure);
    if (p.remarque) setRemarque(p.remarque);
    setFlash(
      p.date && p.date <= todayStr()
        ? `Pré-rempli depuis la dictée (date comprise : ${new Date(`${p.date}T00:00:00`).toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}) — vérifiez, la date reste modifiable ci-dessus.`
        : 'Pré-rempli depuis la dictée — vérifiez puis enregistrez.',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.nonce]);

  const poids = toNum(draft.poids);
  const computed = useMemo(
    () =>
      poids != null && poids > 0
        ? computeWeight({ poids, masseMusculaire: toNum(draft.masseMusculaire) }, weightConfig, sexe)
        : null,
    [poids, draft.masseMusculaire, weightConfig, sexe],
  );

  const canSave = poids != null && poids > 0;

  function set(key: WeightMetricKey, v: string) {
    setAcceptedFields((current) => new Set(current).add(key));
    setDraft((d) => ({ ...d, [key]: v }));
  }

  function reset() {
    setDraft(EMPTY_DRAFT);
    setDate(todayStr());
    setHeure(nowTime());
    setAJeun(true);
    setNu(true);
    setRemarque('');
    setAcceptedFields(new Set());
  }

  function save() {
    if (!canSave) return;
    const entry: Omit<WeightEntry, 'id' | 'createdAt'> = {
      date,
      heure,
      aJeun,
      nu,
      poids: poids!,
      masseGrasse: toNum(draft.masseGrasse),
      eau: toNum(draft.eau),
      masseMusculaire: toNum(draft.masseMusculaire),
      masseOsseuse: toNum(draft.masseOsseuse),
      graisseViscerale: toNum(draft.graisseViscerale),
      metabolismeBasalMachine: toNum(draft.metabolismeBasalMachine),
      remarque: remarque.trim() || undefined,
      source: 'manuel',
    };
    addWeightEntry(entry);
    const when = new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR');
    setFlash(`Pesée enregistrée au ${when} à ${heure} : ${fmt(poids!, 1)} kg.`);
    reset();
  }

  return (
    <div className="panel" data-agent-section="nouvelle-pesee">
      <h2>Nouvelle pesée</h2>

      <div className="row wrap-form">
        <label className="field">
          Date
          <input type="date" value={date} max={todayStr()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="field" style={{ flex: '0 0 110px' }}>
          Heure
          <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <input type="checkbox" checked={aJeun} onChange={(e) => setAJeun(e.target.checked)} style={{ width: 'auto' }} />
          À jeun
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <input type="checkbox" checked={nu} onChange={(e) => setNu(e.target.checked)} style={{ width: 'auto' }} />
          Nu
        </label>
      </div>

      <div className="row wrap-form" style={{ marginTop: 8 }}>
        {NUM_FIELDS.map((m) => (
          <label className="field" key={m.key} style={{ flex: '1 1 130px' }}>
            {m.label}
            {m.unit ? ` (${m.unit})` : ''}
            {m.key === 'poids' ? ' *' : ''}
            <SuggestedNumberField
              min={0}
              step={0.1}
              value={draft[m.key]}
              suggestedValue={lastWeight?.[m.key]}
              accepted={acceptedFields.has(m.key)}
              onAccept={() => setAcceptedFields((current) => new Set(current).add(m.key))}
              onChange={(v) => set(m.key, v)}
            />
          </label>
        ))}
      </div>

      <label className="field" style={{ marginTop: 8 }}>
        Note (optionnelle)
        <input
          type="text"
          placeholder="ex. après le sport, malade, reprise créatine…"
          value={remarque}
          onChange={(e) => setRemarque(e.target.value)}
        />
      </label>

      {computed && (
        <div className="hint" style={{ marginTop: 10 }}>
          <strong>Calculé automatiquement</strong> — IMC : <strong>{fmt(computed.imc, 2)}</strong>
          {computed.masseMusculaireSquelettique != null && (
            <> · Masse musc. squelettique : {fmt(computed.masseMusculaireSquelettique, 2)} kg</>
          )}
          <br />
          Métabolisme basal — Harris-Benedict : {fmt(computed.bmrHarrisBenedict)} kcal · Mifflin-St Jeor :{' '}
          {fmt(computed.bmrMifflinStJeor)} kcal
        </div>
      )}

      <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
        <button className="primary" disabled={!canSave} onClick={save}>
          Enregistrer la pesée
        </button>
      </div>

      {flash && <div className="status" style={{ marginTop: 8 }}>{flash}</div>}
    </div>
  );
}
