import { useEffect, useMemo, useState } from 'react';
import { todayStr, useStore } from '../store/store';
import { defaultPeriod, estimate, intakeGaps, intakeSensitivity, maintenanceDays, MAINTENANCE_MODEL_VERSION, type Options } from '../nutrition/maintenance';
import { computeEnergyFor, type ObservedMaintenance } from '../nutrition/targets';
import { useBody, useTargets } from './useTargets';
import { Section } from './Section';
import { NumberField } from './NumberField';
import { fmt } from './format';
import './maintenance.css';

const defaults = { standardOnly: true, rho: 7700, lag: 7, confidence: 95 as const, intakeBias: 0 };
type Calculation = { result: ReturnType<typeof estimate>; sensitivity: ReturnType<typeof intakeSensitivity>; options: Options; fingerprint: string };

export function MaintenancePanel() {
  const entries = useStore(s => s.entries);
  const weights = useStore(s => s.weightEntries);
  const muted = useStore(s => s.mutedDays);
  const profile = useStore(s => s.profile);
  const setProfile = useStore(s => s.setProfile);
  const body = useBody();
  const targets = useTargets();
  const [standardOnly, setStandardOnly] = useState(true);
  const rows = useMemo(() => maintenanceDays(entries, weights, muted, standardOnly, todayStr()), [entries, weights, muted, standardOnly]);
  const [period, setPeriod] = useState(() => defaultPeriod(rows));
  useEffect(() => {
    if (!period.start && !period.end && rows.length) setPeriod(defaultPeriod(rows, standardOnly));
  }, [rows, standardOnly, period.start, period.end]);
  const [advanced, setAdvanced] = useState<Omit<Options, 'start' | 'end' | 'standardOnly' | 'estimatedIntakes'>>(defaults);
  const [fillMissing, setFillMissing] = useState(false);
  const [intakeOverrides, setIntakeOverrides] = useState<Record<string, string>>({});
  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [error, setError] = useState('');
  const gaps = useMemo(() => intakeGaps(rows, { ...period, standardOnly }), [rows, period, standardOnly]);
  const estimatedIntakes = fillMissing ? Object.fromEntries(gaps.map(g => {
    const raw = intakeOverrides[g.date];
    return [g.date, raw !== undefined ? (raw.trim() ? Number(raw.replace(',', '.')) : NaN) : g.suggested ?? NaN];
  })) : undefined;
  const options: Options = { ...advanced, ...period, standardOnly, estimatedIntakes };
  const fingerprint = JSON.stringify({ rows, options });
  const stale = calculation !== null && calculation.fingerprint !== fingerprint;
  const result = calculation?.result;
  const observed = profile.observedMaintenance;
  const active = profile.maintenanceMode === 'observed' && observed && observed.kcal > 0;
  const formula = computeEnergyFor({ ...profile, maintenanceMode: 'formula' }, body);
  const target = targets.find(t => t.key === 'kcal')!.optimal;

  function calculate() {
    try {
      setCalculation({ result: estimate(rows, options), sensitivity: intakeSensitivity(rows, options), options, fingerprint });
      setError('');
    } catch (e) { setCalculation(null); setError((e as Error).message); }
  }
  function apply() {
    if (!calculation || stale || !Number.isFinite(calculation.result.maintenance) || calculation.result.maintenance <= 0) return;
    const r = calculation.result, o = calculation.options;
    const saved: ObservedMaintenance = { kcal: Math.round(r.maintenance), low: r.low, high: r.high,
      start: r.first, end: r.last, calculatedAt: new Date().toISOString(), n: r.n, duration: r.duration,
      rho: o.rho, lag: o.lag, confidence: o.confidence, intakeBias: o.intakeBias, standardOnly: o.standardOnly, version: MAINTENANCE_MODEL_VERSION,
      ...(r.estimatedDays.length ? { estimatedIntakes: Object.fromEntries(r.estimatedDays.map(d => [d.date, d.kcal])), intakeEstimateMethod: 'local-mean' as const } : {}) };
    setProfile({ observedMaintenance: saved, maintenanceMode: 'observed' });
  }

  return <Section id="maintenance" title="Estimer ma maintenance" defaultOpen={false}
    summary={active ? `${fmt(observed.kcal)} kcal/j · estimation appliquée` : `Formules · ${fmt(formula.tdee)} kcal/j`}>
    <p className="small">Estimation à partir de vos calories enregistrées et de vos pesées. Le calcul reste dans ce navigateur.</p>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className={!active ? 'small chip-active' : 'ghost small'} aria-pressed={!active}
        onClick={() => setProfile({ maintenanceMode: 'formula' })}>Utiliser les formules ({fmt(formula.tdee)} kcal/j)</button>
      {observed && <button type="button" className={active ? 'small chip-active' : 'ghost small'} aria-pressed={!!active}
        onClick={() => setProfile({ maintenanceMode: 'observed' })}>Utiliser mon estimation ({fmt(observed.kcal)} kcal/j)</button>}
    </div>
    {observed && <p className="hint">Estimation enregistrée le {new Date(observed.calculatedAt).toLocaleDateString('fr-FR')} sur la période {observed.start} → {observed.end}.
      {observed.estimatedIntakes && ` ${Object.keys(observed.estimatedIntakes).length} jour(s) de calories estimés.`}
      Elle reste fixe jusqu'à un nouveau calcul appliqué. Objectif calorique actuel : {fmt(target)} kcal/j.</p>}
    <div className="row maintenance-controls">
      <label className="field">Du<input aria-label="Début de la période de maintenance" type="date" value={period.start} max={todayStr()}
        onChange={e => setPeriod(p => ({ ...p, start: e.target.value }))} /></label>
      <label className="field">Au<input aria-label="Fin de la période de maintenance" type="date" value={period.end} max={todayStr()}
        onChange={e => setPeriod(p => ({ ...p, end: e.target.value }))} /></label>
      <button type="button" className="ghost small" onClick={() => setPeriod(defaultPeriod(rows, standardOnly))}>Période continue automatique</button>
      <button type="button" className="ghost small" disabled={!rows.length}
        onClick={() => setPeriod({ start: rows[0].date, end: rows[rows.length - 1].date })}>Toute la période</button>
    </div>
    <label className="row small" style={{ gap: 8, marginBlock: 12 }}><input type="checkbox" checked={standardOnly} onChange={e => setStandardOnly(e.target.checked)} />Pesées à jeun et nu uniquement</label>
    <div className="hint">Une pesée par jour : la dernière respectant le filtre. Les jours non comptés sont exclus des apports ; un jeûne déclaré compte pour zéro.
      La période automatique retient la plus longue série complète. Les calories de la dernière pesée ne sont pas nécessaires.</div>
    {gaps.length > 0 && <div className="maintenance-gaps" role="region" aria-label="Jours de calories manquants">
      <p><strong>{gaps.length} jour(s) sans calories utilisables entre les pesées extrêmes.</strong> Vous pouvez conserver toute la période en estimant ces journées.</p>
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={fillMissing}
        onChange={e => setFillMissing(e.target.checked)} />Estimer les jours manquants</label>
      {fillMissing && <>
        <p className="hint">Moyenne des jours renseignés dans les 7 jours avant et après chaque trou, limitée à la période calculée.
          Sans voisin renseigné, la moyenne de la période est proposée. Aucun repas n'est ajouté au journal ; les jours exclus sont aussi estimés pour ce calcul.</p>
        <details className="maintenance-details"><summary>Voir ou corriger les {gaps.length} journées estimées</summary>
          <div className="maintenance-gap-list">{gaps.map(g => <div className="maintenance-gap" key={g.date}>
            <label className="field">{g.date} · kcal
              <NumberField min={0} step={50} value={intakeOverrides[g.date] ?? g.suggested ?? ''}
                onChange={value => setIntakeOverrides(values => ({ ...values, [g.date]: value }))} />
            </label>
            <span className="hint">{intakeOverrides[g.date] !== undefined ? 'Valeur modifiée' : g.suggested === null ? 'À renseigner : aucun jour connu' :
              `${g.basis === 'local-mean' ? 'Moyenne locale' : 'Moyenne de la période'} · ${g.donorCount} jour(s)`}</span>
          </div>)}</div>
          <button type="button" className="ghost small" onClick={() => setIntakeOverrides({})}>Rétablir les moyennes proposées</button>
        </details>
        <p className="hint">Le résultat dépendra de ces hypothèses. Les journées oubliées peuvent différer des journées renseignées.</p>
      </>}
    </div>}
    <details className="maintenance-details">
      <summary>Hypothèses et sensibilité</summary>
      <div className="maintenance-controls row">
        <label className="field">Conversion (kcal/kg)<NumberField min={1000} max={15000} step={100} value={advanced.rho} onChange={rho => setAdvanced(a => ({ ...a, rho: Number(rho) }))} /></label>
        <label className="field">Corrélation du bruit (jours)<NumberField min={0} max={60} step={1} value={advanced.lag} onChange={lag => setAdvanced(a => ({ ...a, lag: Number(lag) }))} /></label>
        <label className="field">Intervalle statistique<select value={advanced.confidence} onChange={e => setAdvanced(a => ({ ...a, confidence: Number(e.target.value) as Options['confidence'] }))}>
          <option value={90}>90 %</option><option value={95}>95 %</option><option value={99}>99 %</option>
        </select></label>
        <label className="field">Calories omises supposées / jour<NumberField step={25} value={advanced.intakeBias} onChange={intakeBias => setAdvanced(a => ({ ...a, intakeBias: Number(intakeBias) }))} /></label>
      </div>
      <p className="hint">7 700 kcal/kg est une hypothèse de conversion. Ajouter 100 kcal/j supposées omises décale l'estimation de 100 kcal/j : cela ne mesure pas vos erreurs de saisie.</p>
    </details>
    <button type="button" onClick={calculate}>Calculer ma maintenance</button>
    {error && <p role="alert" style={{ color: 'var(--warn)' }}>{error}</p>}
    {calculation && result && <div className="maintenance-result" aria-live="polite">
      <div className="energy-headline"><div><strong className="energy-big mono">{fmt(result.maintenance)}</strong> kcal/j
        <div className="small">Maintenance moyenne estimée sur la période</div></div>
        <div className="small">{result.first} → {result.last}<br />{result.duration} jours · {result.n} pesées</div></div>
      <p>Intervalle statistique approximatif à {calculation.options.confidence} % : <strong>{fmt(result.low)} à {fmt(result.high)} kcal/j</strong>.</p>
      <p className="hint">Conditionnel aux calories saisies et à la conversion choisie. Les biais systématiques et les variations futures d'activité ne sont pas inclus.
        {result.n < 30 || result.duration < 28 ? ' Échantillon limité : comparez plusieurs périodes et hypothèses.' : ''}</p>
      {result.estimatedDays.length > 0 && <div className="maintenance-gaps">
        <p><strong>Résultat avec {result.estimatedDays.length} jour(s) de calories estimés sur {result.duration} ({fmt(result.estimatedDays.length / result.duration * 100)} %).</strong></p>
        {calculation.sensitivity && <p className="small">Sensibilité : si chaque journée estimée varie de −500 à +500 kcal (sans descendre sous zéro),
          la maintenance varie de <strong>{fmt(calculation.sensitivity.low)} à {fmt(calculation.sensitivity.high)} kcal/j</strong>, les autres données restant identiques.</p>}
        <p className="hint">Ce scénario n'est pas un intervalle de confiance. L'intervalle statistique ci-dessus ne couvre pas l'incertitude sur les calories manquantes.</p>
      </div>}
      {stale && <p role="status" style={{ color: 'var(--warn)' }}>Les données ou les réglages ont changé. Recalculez avant d'appliquer.</p>}
      {result.maintenance <= 0 && <p role="alert">L'estimation n'est pas positive ; elle ne peut pas remplacer la maintenance.</p>}
      <button type="button" disabled={stale || !Number.isFinite(result.maintenance) || result.maintenance <= 0} onClick={apply}>Remplacer ma maintenance estimée</button>
      <p className="hint">Cette valeur devient le maintien utilisé dans toute l'app ; le déficit ou surplus choisi continue de s'appliquer.
        Les cibles nutritionnelles réglées directement à la main restent prioritaires. Les objectifs des jours passés restent conservés.</p>
      <details className="maintenance-details"><summary>Données et détail du calcul</summary>
        <p className="small">Pour chaque pesée : t = jours écoulés, A = calories cumulées avant la pesée, y = poids − A / ρ.
          On ajuste y = a + b × t avec toutes les pesées, puis maintenance = −ρ × b.</p>
        <p className="mono small">Pente = {fmt(result.slope, 6)} kg/j · ρ = {fmt(calculation.options.rho)} kcal/kg · résidu = {fmt(result.residualSd, 3)} kg</p>
        <p className="small">Apport moyen : {fmt(result.meanIntake)} kcal/j · estimation avec les seules extrémités : {fmt(result.naive)} kcal/j.</p>
        <div className="maintenance-table"><table><thead><tr><th>Date</th><th>Poids</th><th>Apports cumulés</th><th>Poids ajusté</th><th>Résidu</th></tr></thead>
          <tbody>{result.points.map(p => <tr key={p.date}><td>{p.date}</td><td>{fmt(p.weight!, 2)} kg</td><td>{fmt(p.cumulative)} kcal</td><td>{fmt(p.fitted, 2)} kg</td><td>{fmt(p.residual, 3)} kg</td></tr>)}</tbody></table></div>
        <p className="hint">L'intervalle utilise la distance calendaire entre les résidus (noyau de Bartlett), avec une correction n/(n−2).
          C'est une approximation exploratoire, particulièrement sur peu de pesées. La maintenance et un biais constant de comptage ne sont pas identifiables séparément.</p>
      </details>
    </div>}
  </Section>;
}
