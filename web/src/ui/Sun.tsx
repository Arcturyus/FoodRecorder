import { useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { useStore, todayStr, nowTime } from '../store/store';
import {
  SKY_OPTIONS,
  SKIN_OPTIONS,
  PHENOTYPE_OPTIONS,
  CREME_OPTIONS,
  TIME_PRESETS,
  SUN_DAY_CAP,
  estimateVitaminD,
  vitaminDBreakdown,
  sunVitDForDate,
  normalizeCreme,
  seasonHint,
} from '../sun/vitaminD';
import type { SkyCondition, SkinExposure, Phenotype, Creme, SunExposure } from '../sun/vitaminD';
import { fmt } from './format';

/** Durée lisible : « 45 min », « 1 h », « 1 h 30 ». */
function fmtDuree(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}
/**
 * Section « Soleil » : le soleil n'est pas un aliment, on enregistre ici les
 * sorties (heure, durée, ciel, peau découverte, phototype, crème) et le gain
 * estimé de vitamine D s'ajoute au bilan du jour.
 * Remplissage ultra-rapide : chips + slider, ou dictée (« 30 min au soleil ce
 * midi en t-shirt »). `date` fixe le jour ciblé (défaut aujourd'hui).
 */
export function Sun({ date }: { date?: string } = {}) {
  const exposures = useStore((s) => s.sunExposures);
  const addSunExposure = useStore((s) => s.addSunExposure);
  const updateSunExposure = useStore((s) => s.updateSunExposure);
  const removeSunExposure = useStore((s) => s.removeSunExposure);

  const fixedDate = date != null;
  const [dateState, setDateState] = useState(date ?? todayStr());
  const activeDate = date ?? dateState;

  const [ciel, setCiel] = useState<SkyCondition>('ensoleille');
  const [peau, setPeau] = useState<SkinExposure>('visage-bras');
  const [phenotype, setPhenotype] = useState<Phenotype>('blanc');
  const [creme, setCreme] = useState<Creme>('aucune');
  const [heure, setHeure] = useState(fixedDate ? '13:00' : nowTime());
  const [duree, setDuree] = useState(30);

  const dayExposures = useMemo(
    () => exposures.filter((e) => e.date === activeDate).sort((a, b) => a.heure.localeCompare(b.heure)),
    [exposures, activeDate],
  );
  const totalDay = useMemo(() => sunVitDForDate(exposures, activeDate), [exposures, activeDate]);

  const draft = { date: activeDate, heure, dureeMin: duree, ciel, peau, phenotype, creme };
  const breakdown = vitaminDBreakdown(draft);
  const hint = seasonHint(activeDate);

  function add() {
    addSunExposure({ date: activeDate, heure, dureeMin: duree, ciel, peau, phenotype, creme });
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>☀️ Soleil (vitamine D)</h2>
        <span className="small mono">
          gain du jour : <strong>{fmt(totalDay, 1)} µg</strong>
        </span>
      </div>

      {/* Heure + jour sur une même ligne : créneaux pratiques en un clic + heure/date précises */}
      <div className="sun-field">
        <span className="sun-label">Début de la sortie</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {TIME_PRESETS.map((p) => (
            <button key={p.heure} className={`small ${heure === p.heure ? 'chip-active' : 'ghost'}`} onClick={() => setHeure(p.heure)}>
              {p.label}
            </button>
          ))}
          <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} style={{ width: 104 }} />
          {!fixedDate && (
            <input type="date" value={dateState} max={todayStr()} onChange={(e) => e.target.value && setDateState(e.target.value)} style={{ width: 140 }} />
          )}
        </div>
      </div>

      {/* Durée : slider fin + valeur */}
      <div className="sun-field">
        <span className="sun-label">
          Durée <strong className="mono">{fmtDuree(duree)}</strong>
        </span>
        <input
          type="range"
          min={5}
          max={240}
          step={5}
          value={duree}
          onChange={(e) => setDuree(parseInt(e.target.value, 10))}
          style={{ width: '100%' }}
        />
      </div>

      {/* Ciel + crème solaire : deux critères courts, une seule ligne */}
      <div className="sun-field-row">
        <div className="sun-subfield" style={{ flex: '1 1 auto' }}>
          <span className="sun-label">Ciel</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {SKY_OPTIONS.map((o) => (
              <button key={o.value} className={`small ${ciel === o.value ? 'chip-active' : 'ghost'}`} onClick={() => setCiel(o.value)}>
                {o.short}
              </button>
            ))}
          </div>
        </div>
        <div className="sun-subfield">
          <span className="sun-label">Crème solaire</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {CREME_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`small ${creme === o.value ? 'chip-active' : 'ghost'}`}
                onClick={() => setCreme(o.value)}
                data-tip={
                  o.value === 'visage'
                    ? 'SPF 50 sur le visage seulement : le reste de la peau découverte synthétise normalement'
                    : o.value === 'complete'
                      ? 'SPF 50 sur tout le corps, posé une fois au début, moyennement bien appliqué'
                      : 'Aucune protection solaire'
                }
              >
                {o.short}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Peau découverte + phototype : deux critères "peau", une seule ligne */}
      <div className="sun-field-row">
        <div className="sun-subfield" style={{ flex: '1 1 auto' }}>
          <span className="sun-label">Peau découverte</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {SKIN_OPTIONS.map((o) => (
              <button key={o.value} className={`small ${peau === o.value ? 'chip-active' : 'ghost'}`} onClick={() => setPeau(o.value)} data-tip={o.label}>
                {o.short}
              </button>
            ))}
          </div>
        </div>
        <div className="sun-subfield" style={{ flex: '1 1 auto' }}>
          <span className="sun-label">Phototype de peau</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {PHENOTYPE_OPTIONS.map((o) => (
              <button key={o.value} className={`small ${phenotype === o.value ? 'chip-active' : 'ghost'}`} onClick={() => setPhenotype(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className="primary" onClick={add} disabled={duree <= 0} style={{ marginTop: 8, width: '100%' }}>
        + Ajouter cette sortie (~{fmt(breakdown.gain, 1)} µg)
      </button>

      {/* Gain estimé + formule détaillée */}
      <FormulaBreakdown breakdown={breakdown} />

      {hint && <div className="hint">{hint}</div>}

      {dayExposures.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0' }}>
          {dayExposures.map((e) => (
            <SunRow
              key={e.id}
              e={e}
              onUpdate={(patch) => updateSunExposure(e.id, patch)}
              onRemove={() => removeSunExposure(e.id)}
            />
          ))}
        </ul>
      )}

      <div className="hint">
        Estimation indicative (France métropolitaine) : dépend de la saison, de l'heure, du ciel, de la peau
        découverte, du phototype et de la crème. Le gain s'ajoute à la vitamine D du bilan du jour.
      </div>
    </div>
  );
}
/**
 * Une sortie enregistrée : résumé sur une ligne, dépliable pour corriger sur
 * place. La dictée étant auto-validée, c'est ici qu'on rattrape ce que l'IA a
 * mal compris, sans devoir supprimer puis re-saisir.
 */
function SunRow({
  e,
  onUpdate,
  onRemove,
}: {
  e: SunExposure;
  onUpdate: (patch: Partial<Omit<SunExposure, 'id' | 'createdAt'>>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const creme = normalizeCreme(e.creme);

  return (
    <li style={{ borderTop: '1px solid var(--border)', padding: '6px 0' }}>
      <div className="row small" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>
          {e.heure} · {fmtDuree(e.dureeMin)} · {SKY_OPTIONS.find((o) => o.value === e.ciel)?.short ?? e.ciel}
          {' · '}
          {SKIN_OPTIONS.find((o) => o.value === e.peau)?.short ?? e.peau}
          {creme !== 'aucune' ? ` · 🧴${creme === 'visage' ? ' visage' : ''}` : ''}
          {' → '}
          <strong className="mono">{fmt(estimateVitaminD(e), 1)} µg</strong>
        </span>
        <span className="row" style={{ gap: 4 }}>
          <button
            className={`ghost small ${open ? 'chip-active' : ''}`}
            onClick={() => setOpen((o) => !o)}
            data-tip="Corriger cette sortie"
            aria-expanded={open}
          >
            {open ? 'Fermer' : '✎ Modifier'}
          </button>
          <button
            className="ghost small"
            data-tip="Supprimer cette sortie"
            onClick={() => window.confirm(`Supprimer cette sortie au soleil (${e.heure}) ?`) && onRemove()}
          >
            ✕
          </button>
        </span>
      </div>

      {open && (
        <div style={{ padding: '8px 0 4px' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
              Début
              <input
                type="time"
                value={e.heure}
                onChange={(ev) => ev.target.value && onUpdate({ heure: ev.target.value })}
                style={{ width: 104 }}
              />
            </label>
            <label className="row small" style={{ gap: 6, alignItems: 'center', flex: '1 1 220px' }}>
              Durée <strong className="mono">{fmtDuree(e.dureeMin)}</strong>
              <input
                type="range"
                min={5}
                max={240}
                step={5}
                value={e.dureeMin}
                onChange={(ev) => onUpdate({ dureeMin: parseInt(ev.target.value, 10) })}
                style={{ flex: 1 }}
              />
            </label>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {SKY_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`small ${e.ciel === o.value ? 'chip-active' : 'ghost'}`}
                onClick={() => onUpdate({ ciel: o.value })}
              >
                {o.short}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {SKIN_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`small ${e.peau === o.value ? 'chip-active' : 'ghost'}`}
                onClick={() => onUpdate({ peau: o.value })}
                data-tip={o.label}
              >
                {o.short}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {PHENOTYPE_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`small ${e.phenotype === o.value ? 'chip-active' : 'ghost'}`}
                onClick={() => onUpdate({ phenotype: o.value })}
              >
                {o.label}
              </button>
            ))}
            {CREME_OPTIONS.map((o) => (
              <button
                key={o.value}
                className={`small ${creme === o.value ? 'chip-active' : 'ghost'}`}
                onClick={() => onUpdate({ creme: o.value })}
                data-tip={o.label}
              >
                {o.value === 'aucune' ? 'Sans crème' : o.short}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Formule affichée avec la valeur de chaque multiplicateur. Survoler (ou taper)
 * un terme détaille son rôle dans une carte sous la formule : icône, valeur,
 * jauge de force et explication. Sans survol : synthèse du calcul.
 */
function FormulaBreakdown({ breakdown }: { breakdown: ReturnType<typeof vitaminDBreakdown> }) {
  const [active, setActive] = useState<string | null>(null);
  const factor = breakdown.factors.find((f) => f.key === active) ?? null;
  const lineRef = useRef<HTMLDivElement>(null);

  // Le survol / focus ne se relâche qu'en quittant tout le groupe : passer d'un
  // terme à l'autre (ou par l'interstice entre eux) ne fait donc pas clignoter
  // le détail sur l'état par défaut entre deux survols.
  const clearIfLeavingGroup = (e: FocusEvent) => {
    if (!lineRef.current?.contains(e.relatedTarget as Node)) setActive(null);
  };

  return (
    <div className="sun-formula">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="small" style={{ opacity: 0.85 }}>Gain estimé de vitamine D</span>
        <span className="mono" style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
          {fmt(breakdown.gain, 1)} µg
          {breakdown.capped && <span className="small" style={{ color: 'var(--warn)' }}> (plafonné)</span>}
        </span>
      </div>

      <div className="sun-formula-line" ref={lineRef} onMouseLeave={() => setActive(null)} onBlur={clearIfLeavingGroup}>
        <span
          className={`sun-term is-base ${active === 'base' ? 'active' : ''}`}
          tabIndex={0}
          onMouseEnter={() => setActive('base')}
          onFocus={() => setActive('base')}
        >
          <span className="sun-sym">base</span>
          <span className="sun-val">{fmt(breakdown.base, 1)}</span>
        </span>
        {breakdown.factors.map((f) => (
          <span key={f.key} className="sun-term-wrap">
            <span className="sun-op">×</span>
            <span
              className={`sun-term ${active === f.key ? 'active' : ''} ${f.gauge < 0.34 ? 'weak' : ''}`}
              tabIndex={0}
              onMouseEnter={() => setActive(f.key)}
              onFocus={() => setActive(f.key)}
            >
              <span className="sun-sym">{f.icon} {f.symbol}</span>
              <span className="sun-val">{f.display}</span>
            </span>
          </span>
        ))}
      </div>

      <div className="sun-detail">
        <div key={active ?? 'default'} className="sun-detail-inner">
          {factor ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontWeight: 600 }}>{factor.icon} {factor.label}</span>
                <span className="mono" style={{ color: 'var(--accent)', fontWeight: 700 }}>{factor.display}</span>
              </div>
              <div className="sun-gauge"><i style={{ width: `${Math.round(factor.gauge * 100)}%` }} /></div>
              <div className="small" style={{ marginTop: 6 }}>{factor.detail}</div>
            </>
          ) : active === 'base' ? (
            <>
              <div style={{ fontWeight: 600 }}>Débit de base</div>
              <div className="small" style={{ marginTop: 6 }}>
                {fmt(breakdown.base, 1)} µg synthétisés par minute efficace en conditions optimales (plein été,
                midi solaire, ciel dégagé, visage + bras, peau claire, sans crème). Chaque facteur ci-dessus le
                module de 0 à 1.
              </div>
            </>
          ) : (
            <div className="small">
              Survolez un facteur pour comprendre son effet. Résultat = <strong>base × tous les facteurs</strong>,
              plafonné à {fmt(SUN_DAY_CAP)} µg/j.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
