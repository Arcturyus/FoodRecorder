import { useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import { useStore, todayStr, nowTime } from '../store/store';
import { MicRecorder } from '../stt/recorder';
import { isSttLoaded, loadStt, transcribe } from '../stt/whisper';
import { NativeRecognizer } from '../stt/webspeech';
import { extractSun } from '../extraction/sun';
import type { SunPatch } from '../extraction/sun';
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
import type { SkyCondition, SkinExposure, Phenotype, Creme } from '../sun/vitaminD';
import { fmt } from './format';

/** Durée lisible : « 45 min », « 1 h », « 1 h 30 ». */
function fmtDuree(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** Résumé court d'un patch dicté (vérification rapide). */
function summarizeSun(p: SunPatch): string {
  const parts: string[] = [];
  if (p.date) parts.push(new Date(`${p.date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }));
  if (p.heure) parts.push(p.heure);
  if (p.dureeMin != null) parts.push(fmtDuree(p.dureeMin));
  if (p.ciel) parts.push(SKY_OPTIONS.find((o) => o.value === p.ciel)?.label ?? p.ciel);
  if (p.peau) parts.push(SKIN_OPTIONS.find((o) => o.value === p.peau)?.short ?? p.peau);
  if (p.phenotype) parts.push(PHENOTYPE_OPTIONS.find((o) => o.value === p.phenotype)?.label ?? p.phenotype);
  if (p.creme && normalizeCreme(p.creme) !== 'aucune') {
    parts.push(CREME_OPTIONS.find((o) => o.value === normalizeCreme(p.creme))?.label ?? 'crème solaire');
  }
  return parts.join(' · ');
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

  /** Applique un patch dicté aux champs du formulaire. */
  function applyPatch(p: SunPatch) {
    if (p.date && !fixedDate) setDateState(p.date);
    if (p.heure) setHeure(p.heure);
    if (p.dureeMin != null) setDuree(Math.min(240, Math.max(5, Math.round(p.dureeMin))));
    if (p.ciel) setCiel(p.ciel);
    if (p.peau) setPeau(p.peau);
    if (p.phenotype) setPhenotype(p.phenotype);
    if (p.creme != null) setCreme(normalizeCreme(p.creme));
  }

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

      <SunDictation onPatch={applyPatch} />

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
                title={
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
              <button key={o.value} className={`small ${peau === o.value ? 'chip-active' : 'ghost'}`} onClick={() => setPeau(o.value)} title={o.label}>
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
            <li
              key={e.id}
              className="row small"
              style={{ justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', gap: 8 }}
            >
              <span>
                {e.heure} · {fmtDuree(e.dureeMin)} · {SKY_OPTIONS.find((o) => o.value === e.ciel)?.short ?? e.ciel}
                {' · '}
                {SKIN_OPTIONS.find((o) => o.value === e.peau)?.short ?? e.peau}
                {normalizeCreme(e.creme) !== 'aucune'
                  ? ` · 🧴${normalizeCreme(e.creme) === 'visage' ? ' visage' : ''}`
                  : ''}
                {' → '}
                <strong className="mono">{fmt(estimateVitaminD(e), 1)} µg</strong>
              </span>
              <button className="ghost small" onClick={() => removeSunExposure(e.id)} title="Supprimer cette sortie">
                ✕
              </button>
            </li>
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

/**
 * Dictée d'une sortie au soleil : mêmes moteurs STT/extraction que le reste de
 * l'app ; le résultat pré-remplit le formulaire (à ajuster puis ajouter).
 */
function SunDictation({ onPatch }: { onPatch: (p: SunPatch) => void }) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);
  const nativeRef = useRef<NativeRecognizer | null>(null);

  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const sttEngine = useStore((s) => s.sttEngine);
  const sttModel = useStore((s) => s.sttModel);

  async function handleRecord() {
    return sttEngine === 'native' ? handleNative() : handleWhisper();
  }

  async function handleNative() {
    if (!recording) {
      try {
        const rec = new NativeRecognizer();
        rec.start((live) => setText(live));
        nativeRef.current = rec;
        setRecording(true);
        setStatus('Dictée en cours… (parlez, puis cliquez pour arrêter)');
      } catch (e) {
        setStatus(`Reconnaissance vocale indisponible : ${(e as Error).message}`);
      }
      return;
    }
    setRecording(false);
    setBusy(true);
    try {
      const transcript = await nativeRef.current!.stop();
      if (transcript) setText(transcript);
      setStatus(transcript ? 'Relisez puis « Analyser ».' : 'Aucune parole reconnue.');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      nativeRef.current = null;
      setBusy(false);
    }
  }

  async function handleWhisper() {
    if (!recording) {
      try {
        const rec = new MicRecorder();
        await rec.start();
        recorderRef.current = rec;
        setRecording(true);
        setStatus('Enregistrement… (parlez, puis cliquez pour arrêter)');
      } catch {
        setStatus('Micro inaccessible. Vérifiez les autorisations du navigateur.');
      }
      return;
    }
    setRecording(false);
    setBusy(true);
    try {
      const { audio } = await recorderRef.current!.stop();
      if (audio.length === 0) {
        setStatus('Aucun son capté.');
        return;
      }
      if (!isSttLoaded()) {
        setStatus('Chargement du modèle de transcription…');
        await loadStt(sttModel, (s, p) => setStatus(`Modèle STT : ${s} ${Math.round(p * 100)}%`));
      }
      setStatus('Transcription…');
      const transcript = await transcribe(audio);
      setText(transcript);
      setStatus(transcript ? 'Relisez puis « Analyser ».' : 'Aucune parole reconnue.');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    const clean = text.trim();
    if (!clean) {
      setStatus('Rien à analyser.');
      return;
    }
    setBusy(true);
    setStatus('Extraction…');
    try {
      const { patch, source } = await extractSun(clean, extractionMode, cloudApiKey, cloudModel);
      if (Object.keys(patch).length === 0) {
        setStatus('Rien compris. Réglez les curseurs à la main ci-dessous.');
        return;
      }
      onPatch(patch);
      const via = source === 'rules' && extractionMode !== 'rules' ? ' [règles, IA indisponible]' : '';
      setStatus(`✓ Compris${via} : ${summarizeSun(patch)}`);
      setText('');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ margin: '6px 0 10px' }}>
      <div className="mic-row">
        <button className={`record-btn ${recording ? 'rec' : 'primary'}`} onClick={handleRecord} disabled={busy && !recording}>
          {recording ? '⏹ Arrêter' : '🎙 Dicter'}
        </button>
        <textarea
          placeholder="…ou dictez : « 30 min au soleil ce midi en t-shirt, peau claire, sans crème »"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) analyze();
          }}
        />
        <button onClick={analyze} disabled={busy || !text.trim()}>
          Analyser
        </button>
      </div>
      {status && <div className="status">{status}</div>}
    </div>
  );
}
