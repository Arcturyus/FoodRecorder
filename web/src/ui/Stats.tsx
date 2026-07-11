import { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line, arc as d3arc, pie as d3pie } from 'd3-shape';
import { max as d3max } from 'd3-array';
import { useStore, todayStr } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import type { Target } from '../nutrition/targets';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { sunVitDForDate } from '../sun/vitaminD';
import { vitaminDFlux, VITD_LOW, VITD_OK } from '../sun/vitaminDStatus';
import { HoverCard } from './HoverCard';
import {
  PeriodSelector,
  resolveRange,
  datesInRange,
  rangeDays,
  defaultPeriodState,
} from './PeriodSelector';
import type { PeriodState } from './PeriodSelector';
import { fmt } from './format';

/** Palette alignée sur les variables CSS du thème. */
const C = {
  accent: '#5b8cff',
  accent2: '#3ecf8e',
  warn: '#f5a623',
  danger: '#ef5d5d',
  muted: '#9aa2b1',
  border: '#2a2f3a',
  text: '#e6e8ec',
  panel2: '#1f232c',
};

/** Couleurs de séries (tendance multi-nutriments), encodage stable par ordre de sélection. */
const SERIES_COLORS = ['#5b8cff', '#3ecf8e', '#f5a623', '#ef5d5d', '#a58bff', '#4dc9d0', '#e3c65b', '#d16ba5'];

const KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

function dayMs(date: string): number {
  return new Date(`${date}T12:00:00`).getTime();
}

function fmtVal(v: number): string {
  return fmt(v, v < 10 ? 1 : 0);
}

/**
 * Écran Stats : analyses interactives recalculées sur la période choisie
 * (7 / 14 / 30 / 90 j). Aucune vue « du jour » (déjà visible sur l'accueil).
 *  - Tendance multi-nutriments (courbes en % de l'objectif, comparables) ;
 *  - Couverture moyenne par nutriment vs objectifs (clic = ajoute à la tendance) ;
 *  - Radar micros (moyenne/jour) et donut macros (moyenne/jour).
 */
export function Stats() {
  const entries = useStore((s) => s.entries);
  const sunExposures = useStore((s) => s.sunExposures);
  const profile = useStore((s) => s.profile);
  const targets = useMemo(() => computeTargets(profile), [profile]);
  const targetByKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);

  const [period, setPeriod] = useState<PeriodState>(defaultPeriodState);
  const [selected, setSelected] = useState<NutrientKey[]>(['kcal', 'proteines']);

  /** Totaux par jour (tous nutriments) pour tout l'historique. */
  const byDate = useMemo(() => {
    const map = new Map<string, Nutrients>();
    for (const e of entries) {
      let t = map.get(e.date);
      if (!t) {
        t = { ...EMPTY_NUTRIENTS };
        map.set(e.date, t);
      }
      for (const it of e.items) for (const k of KEYS) t[k] += it.nutrients[k] ?? 0;
    }
    return map;
  }, [entries]);

  /** 1re date enregistrée (borne « Tout »). */
  const earliest = useMemo(() => {
    let min: string | undefined;
    for (const d of byDate.keys()) if (min === undefined || d < min) min = d;
    return min;
  }, [byDate]);

  const range = useMemo(() => resolveRange(period, earliest), [period, earliest]);
  const days = rangeDays(range);
  const windowDates = useMemo(() => datesInRange(range), [range]);
  const recorded = useMemo(() => windowDates.filter((d) => byDate.has(d)), [windowDates, byDate]);

  /** Moyenne journalière de chaque nutriment sur les jours enregistrés de la fenêtre. */
  const averages = useMemo(() => {
    const a = { ...EMPTY_NUTRIENTS };
    if (recorded.length === 0) return a;
    for (const d of recorded) {
      const t = byDate.get(d)!;
      for (const k of KEYS) a[k] += t[k];
    }
    for (const k of KEYS) a[k] /= recorded.length;
    return a;
  }, [recorded, byDate]);

  /** Apport vitamine D total par jour (alimentation + soleil), tous jours « connus ». */
  const vitDByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const [d, t] of byDate) m.set(d, t.vitD);
    for (const d of new Set(sunExposures.map((e) => e.date))) {
      m.set(d, (m.get(d) ?? 0) + sunVitDForDate(sunExposures, d));
    }
    return m;
  }, [byDate, sunExposures]);

  const vitDStatus = useMemo(() => vitaminDFlux(vitDByDate, todayStr()), [vitDByDate]);

  const toggle = (k: NutrientKey) =>
    setSelected((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  /** Séries de la tendance : une par nutriment sélectionné, valeurs en % de l'objectif. */
  const series = useMemo(
    () =>
      selected.map((key, i) => {
        const t = targetByKey.get(key)!;
        const objective = t.goal === 'limit' ? t.ajr : t.optimal;
        return {
          key,
          label: t.label,
          unit: t.unit,
          goal: t.goal,
          color: SERIES_COLORS[i % SERIES_COLORS.length],
          objective,
          points: recorded.map((d) => {
            const value = byDate.get(d)![key];
            return { date: d, t: dayMs(d), value, pct: objective > 0 ? (value / objective) * 100 : 0 };
          }),
        };
      }),
    [selected, targetByKey, recorded, byDate],
  );

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Analyse sur {days} jours</h2>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
        <div className="hint">
          {recorded.length} jour(s) enregistré(s) sur cette période ({days} j) — tout est recalculé sur la période.
        </div>
      </div>

      <div className="panel">
        <h2>Tendance comparée</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Chaque courbe = un nutriment en <strong>% de son objectif</strong> (ligne 100 %), pour comparer des unités
          différentes. Survolez pour les valeurs réelles. Cliquez des nutriments ci-dessous (ou les puces) pour les
          ajouter/retirer.
        </p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {series.length === 0 && <span className="small">Aucun nutriment sélectionné.</span>}
          {series.map((s) => (
            <button key={s.key} className="chip-series" onClick={() => toggle(s.key)} style={{ borderColor: s.color }}>
              <i style={{ background: s.color }} />
              {s.label} ✕
            </button>
          ))}
        </div>
        <MultiTrend series={series} windowDates={windowDates} />
      </div>

      <div className="panel">
        <h2>Couverture moyenne vs objectifs</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Barres triées du moins couvert au mieux couvert (moyenne/jour sur la période).{' '}
          <span className="ref-legend ajr" /> AJR · <span className="ref-legend opti" /> objectif optimal (100 %).
          Cliquez un nutriment pour l'ajouter à la tendance.
        </p>
        <CoverageList averages={averages} targets={targets} selected={selected} onToggle={toggle} />
      </div>

      <div className="panel">
        <h2>Couverture micronutritionnelle (moyenne/jour)</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Rayon = % de la cible optimale (anneau plein = 100 %). Survolez un sommet pour le détail.
        </p>
        <RadarChart totals={averages} targets={targets} />
      </div>

      <div className="panel">
        <h2>Répartition des calories (macros, moyenne/jour)</h2>
        <MacroDonut totals={averages} />
      </div>

      <div className="panel">
        <h2>☀️ Vitamine D : carence ?</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Flux moyen d'entrée (alimentation + soleil), lissé sur ~4 semaines et pondéré par la récence — cohérent avec
          la demi-vie de la 25(OH)D (~2–3 semaines).
        </p>
        <VitaminDCard status={vitDStatus} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Carence vitamine D (flux moyen soleil + alimentation)
// ---------------------------------------------------------------------------

function VitaminDCard({ status }: { status: ReturnType<typeof vitaminDFlux> }) {
  if (!status) {
    return <div className="empty">Enregistrez des repas ou des expositions au soleil pour estimer votre flux de vitamine D.</div>;
  }

  const zoneClass = status.zone === 'ok' ? 'ok' : status.zone === 'low' ? 'low' : 'mid';
  const arrow = status.trend === 'up' ? '↑' : status.trend === 'down' ? '↓' : '→';
  const trendWord = status.trend === 'up' ? 'en hausse' : status.trend === 'down' ? 'en baisse' : 'stable';
  const weeks = Math.round(status.windowDays / 7);
  // Repère sur l'échelle 0 → ~25 µg (au-delà = confortable).
  const markPct = Math.min(100, (status.weightedAvg / 25) * 100);

  return (
    <>
      <div className="vitd-card">
        <div>
          <span className="vitd-big" style={{ color: `var(--${status.zone === 'ok' ? 'accent-2' : status.zone === 'low' ? 'danger' : 'warn'})` }}>
            {fmt(status.weightedAvg, 1)}
          </span>
          <span className="small"> µg/j</span>
          <div className="small" style={{ marginTop: 2 }}>
            {arrow} {trendWord} sur {weeks} semaines · {status.nDays} jour(s) de données
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="vitd-scale">
            <i style={{ left: `${markPct}%` }} />
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small">carence &lt; {VITD_LOW}</span>
            <span className="small">suffisant ≥ {VITD_OK} µg</span>
          </div>
        </div>
        <HoverCard
          align="right"
          card={
            <div style={{ maxWidth: 250 }}>
              <strong>Comment lire ce statut</strong>
              <div className="hc-zones">
                <div className={status.zone === 'low' ? 'on' : ''}><i className="z low" /> &lt; {VITD_LOW} µg/j — risque de carence</div>
                <div className={status.zone === 'mid' ? 'on' : ''}><i className="z mid" /> {VITD_LOW}–{VITD_OK} µg/j — zone intermédiaire</div>
                <div className={status.zone === 'ok' ? 'on' : ''}><i className="z ok" /> ≥ {VITD_OK} µg/j — apport suffisant</div>
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                Moyenne pondérée sur {Math.round(status.windowDays / 7)} semaines ({status.nDays} jour(s) de données).
                Le lissage long (demi-vie ~3 semaines) évite les sauts de statut d'un jour à l'autre.
              </div>
            </div>
          }
        >
          <span className={`vitd-status ${zoneClass}`}>{status.statusLabel}</span>
        </HoverCard>
      </div>
      <div className="hint" style={{ marginTop: 10 }}>
        <strong>
          {fmt(status.weightedAvg, 1)} µg/j ({arrow} {trendWord}) → {status.statusLabel}
        </strong>
        <br />
        {status.advice}
      </div>
    </>
  );
}

/** Convertit un événement pointeur en coordonnées viewBox (responsive). */
function toViewBox(e: React.PointerEvent | React.MouseEvent, svg: SVGSVGElement, W: number, H: number) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
    px: e.clientX - rect.left,
    py: e.clientY - rect.top,
  };
}

// ---------------------------------------------------------------------------
// Tendance multi-nutriments (courbes en % d'objectif)
// ---------------------------------------------------------------------------

type Series = {
  key: NutrientKey;
  label: string;
  unit: string;
  goal: Target['goal'];
  color: string;
  objective: number;
  points: { date: string; t: number; value: number; pct: number }[];
};

function MultiTrend({ series, windowDates }: { series: Series[]; windowDates: string[] }) {
  const W = 680;
  const H = 300;
  const m = { top: 16, right: 16, bottom: 30, left: 44 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [ptr, setPtr] = useState({ px: 0, py: 0 });

  const recorded = series[0]?.points.map((p) => p.date) ?? [];

  if (series.length === 0 || recorded.length === 0) {
    return <div className="empty">Sélectionnez au moins un nutriment et enregistrez des jours sur la période.</div>;
  }

  const xs = scaleLinear()
    .domain([dayMs(windowDates[0]), dayMs(windowDates[windowDates.length - 1])])
    .range([m.left, W - m.right]);
  const maxPct = d3max(series.flatMap((s) => s.points.map((p) => p.pct))) ?? 100;
  const yMax = Math.max(150, maxPct * 1.1);
  const ys = scaleLinear().domain([0, yMax]).nice().range([H - m.bottom, m.top]);

  const yTicks = ys.ticks(4);
  const xTicks = xs.ticks(Math.min(6, recorded.length));
  const fmtDate = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  const lineGen = d3line<Series['points'][number]>()
    .x((d) => xs(d.t))
    .y((d) => ys(d.pct));

  function onMove(e: React.MouseEvent) {
    if (!svgRef.current) return;
    const p = toViewBox(e, svgRef.current, W, H);
    let best = 0;
    let bd = Infinity;
    recorded.forEach((d, i) => {
      const dist = Math.abs(xs(dayMs(d)) - p.x);
      if (dist < bd) {
        bd = dist;
        best = i;
      }
    });
    setHover(best);
    setPtr({ px: (p.px / svgRef.current.getBoundingClientRect().width) * 100, py: (p.py / svgRef.current.getBoundingClientRect().height) * 100 });
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((tk) => (
          <g key={tk}>
            <line x1={m.left} x2={W - m.right} y1={ys(tk)} y2={ys(tk)} stroke={C.border} strokeWidth={1} />
            <text x={m.left - 8} y={ys(tk)} fill={C.muted} fontSize={10} textAnchor="end" dominantBaseline="middle">
              {fmt(tk)}%
            </text>
          </g>
        ))}

        {/* ligne objectif 100 % */}
        <line x1={m.left} x2={W - m.right} y1={ys(100)} y2={ys(100)} stroke={C.accent2} strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - m.right} y={ys(100) - 5} fill={C.accent2} fontSize={10} textAnchor="end">
          objectif 100 %
        </text>

        {series.map((s) => (
          <g key={s.key}>
            <path d={lineGen(s.points)!} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((p, i) => (
              <circle key={p.date} cx={xs(p.t)} cy={ys(p.pct)} r={hover === i ? 4.5 : 3} fill={s.color} stroke={C.panel2} strokeWidth={1.5} />
            ))}
          </g>
        ))}

        {xTicks.map((tk) => (
          <text key={tk} x={xs(tk)} y={H - 10} fill={C.muted} fontSize={10} textAnchor="middle">
            {fmtDate(tk)}
          </text>
        ))}

        {hover !== null && (
          <line x1={xs(dayMs(recorded[hover]))} x2={xs(dayMs(recorded[hover]))} y1={m.top} y2={H - m.bottom} stroke={C.muted} strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>

      {hover !== null && (
        <Tooltip px={ptr.px} py={ptr.py}>
          <strong>{dayLabel(recorded[hover])}</strong>
          {series.map((s) => {
            const p = s.points[hover];
            return (
              <div key={s.key} style={{ marginTop: 2 }}>
                <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 5 }} />
                {s.label} : <strong>{fmtVal(p.value)}</strong> {s.unit} · <span style={{ color: p.pct >= 100 ? C.accent2 : C.warn }}>{fmt(p.pct)} %</span>
              </div>
            );
          })}
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Couverture moyenne par nutriment (barres cliquables → tendance)
// ---------------------------------------------------------------------------

const CAP = 150;

interface CovRow {
  t: Target;
  avg: number;
  pct: number;
  isLimit: boolean;
}

/** Contenu de l'info-bulle riche d'un nutriment (suivi souris). */
function CoverageCard({ t, avg, pct, isLimit }: CovRow) {
  const covered = pct >= 100;
  const color = isLimit ? (pct > 100 ? 'var(--danger)' : 'var(--accent-2)') : covered ? 'var(--accent-2)' : 'var(--warn)';
  const bg = isLimit ? (pct > 100 ? 'rgba(239,93,93,0.18)' : 'rgba(123,201,111,0.16)') : covered ? 'rgba(123,201,111,0.16)' : 'rgba(245,166,35,0.16)';
  return (
    <div style={{ maxWidth: 240 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>{t.label}</strong>
        <span className="hc-badge" style={{ background: bg, color }}>{fmt(pct)} %</span>
      </div>
      <div className="small" style={{ margin: '6px 0 8px' }}>{t.role}</div>
      <div className="hc-rows">
        <div><span>Apport moyen</span><span className="mono">{fmtVal(avg)} {t.unit}/j</span></div>
        <div><span>AJR</span><span className="mono">{fmt(t.ajr)} {t.unit}</span></div>
        <div><span>{isLimit ? 'Idéal ≤' : 'Optimal'}</span><span className="mono">{fmt(t.optimal)} {t.unit}</span></div>
      </div>
      {t.optimalNote && <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>💡 {t.optimalNote}</div>}
      <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>Cliquez pour l'ajouter à la tendance</div>
    </div>
  );
}

function CoverageList({
  averages,
  targets,
  selected,
  onToggle,
}: {
  averages: Nutrients;
  targets: Target[];
  selected: NutrientKey[];
  onToggle: (k: NutrientKey) => void;
}) {
  // Info-bulle unique qui suit la souris (déclenchée par la ligne entière).
  const [tip, setTip] = useState<{ row: CovRow; x: number; y: number } | null>(null);

  const atLeast: CovRow[] = targets
    .filter((t) => t.goal !== 'limit')
    .map((t) => ({ t, avg: averages[t.key], pct: t.optimal > 0 ? (averages[t.key] / t.optimal) * 100 : 0, isLimit: false }))
    .sort((a, b) => a.pct - b.pct);
  const limits: CovRow[] = targets
    .filter((t) => t.goal === 'limit')
    .map((t) => ({ t, avg: averages[t.key], pct: t.ajr > 0 ? (averages[t.key] / t.ajr) * 100 : 0, isLimit: true }))
    .sort((a, b) => b.pct - a.pct);

  function row(r: CovRow) {
    const { t, avg, pct, isLimit } = r;
    const width = (Math.min(pct, CAP) / CAP) * 100;
    const barClass = isLimit ? (pct > 100 ? 'over' : avg <= t.optimal ? 'good' : '') : pct >= 100 ? 'good' : '';
    const refPct = isLimit ? (t.optimal / t.ajr) * 100 : (t.ajr / t.optimal) * 100;
    const isSel = selected.includes(t.key);
    return (
      <div
        className={`cov-row${isSel ? ' sel' : ''}`}
        key={t.key}
        onClick={() => onToggle(t.key)}
        onMouseMove={(e) => setTip({ row: r, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setTip((prev) => (prev?.row.t.key === t.key ? null : prev))}
      >
        <span className="cov-label">
          {isSel && <span style={{ color: 'var(--accent)' }}>● </span>}
          {t.label}
        </span>
        <div className={`bar ${barClass}`}>
          <span style={{ width: `${width}%` }} />
          <span className={`mark ${isLimit ? 'opti' : 'ajr'}`} style={{ left: `${(refPct / CAP) * 100}%` }} />
          <span className={`mark ${isLimit ? 'ajr' : 'opti'}`} style={{ left: `${(100 / CAP) * 100}%` }} />
        </div>
        <span className="mono small" style={{ textAlign: 'right' }}>
          {fmtVal(avg)} {t.unit}/j · {fmt(pct)} %
        </span>
      </div>
    );
  }

  return (
    <>
      {atLeast.map((x) => row(x))}
      <div className="small" style={{ margin: '12px 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
        À limiter (plus bas = mieux)
      </div>
      {limits.map((x) => row(x))}
      {tip && (
        <FollowTip x={tip.x} y={tip.y}>
          <CoverageCard {...tip.row} />
        </FollowTip>
      )}
    </>
  );
}

/**
 * Info-bulle flottante en position fixe qui suit le curseur (au-dessus de lui),
 * bornée horizontalement pour ne pas déborder de l'écran.
 */
function FollowTip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const margin = 150;
  const left = Math.min(Math.max(x, margin), (typeof window !== 'undefined' ? window.innerWidth : 1024) - margin);
  return (
    <div className="follow-tip" style={{ left, top: y - 16 }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radar micros (moyenne/jour)
// ---------------------------------------------------------------------------

const RADAR_KEYS: NutrientKey[] = ['proteines', 'fibres', 'fer', 'magnesium', 'calcium', 'zinc', 'vitC', 'vitD', 'vitB12', 'potassium'];

function RadarChart({ totals, targets }: { totals: Record<NutrientKey, number>; targets: Target[] }) {
  const W = 380;
  const H = 340;
  const cx = W / 2;
  const cy = H / 2 + 6;
  const R = 118;
  const CAP = 1.5;

  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [ptr, setPtr] = useState({ px: 0, py: 0 });

  const axes = RADAR_KEYS.map((key, i) => {
    const t = targets.find((x) => x.key === key)!;
    const value = totals[key] ?? 0;
    const ratio = t.optimal > 0 ? value / t.optimal : 0;
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / RADAR_KEYS.length;
    const rr = (Math.min(ratio, CAP) / CAP) * R;
    return {
      key,
      label: t.label,
      unit: t.unit,
      value,
      optimal: t.optimal,
      pct: ratio * 100,
      angle,
      x: cx + rr * Math.cos(angle),
      y: cy + rr * Math.sin(angle),
      lx: cx + (R + 20) * Math.cos(angle),
      ly: cy + (R + 20) * Math.sin(angle),
    };
  });

  const polygon = axes.map((a) => `${a.x},${a.y}`).join(' ');
  const rings = [0.5, 1, 1.5];

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 440, display: 'block', margin: '0 auto' }} onMouseLeave={() => setHover(null)}>
        {rings.map((r) => (
          <circle key={r} cx={cx} cy={cy} r={(r / CAP) * R} fill="none" stroke={C.border} strokeWidth={1} />
        ))}
        <circle cx={cx} cy={cy} r={(1 / CAP) * R} fill="none" stroke={C.accent2} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7} />

        {axes.map((a) => (
          <line key={a.key} x1={cx} y1={cy} x2={cx + R * Math.cos(a.angle)} y2={cy + R * Math.sin(a.angle)} stroke={C.border} strokeWidth={1} />
        ))}

        <polygon points={polygon} fill={C.accent} fillOpacity={0.25} stroke={C.accent} strokeWidth={2} />

        {axes.map((a, i) => (
          <g key={a.key}>
            <circle cx={a.x} cy={a.y} r={hover === i ? 6 : 4} fill={a.pct >= 100 ? C.accent2 : C.accent} stroke={C.text} strokeWidth={hover === i ? 1.5 : 0} />
            <circle
              cx={a.x}
              cy={a.y}
              r={14}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={(e) => {
                setHover(i);
                if (svgRef.current) {
                  const p = toViewBox(e, svgRef.current, W, H);
                  setPtr({ px: (p.px / svgRef.current.getBoundingClientRect().width) * 100, py: (p.py / svgRef.current.getBoundingClientRect().height) * 100 });
                }
              }}
            />
            <text x={a.lx} y={a.ly} fill={hover === i ? C.text : C.muted} fontSize={11} textAnchor={Math.abs(a.lx - cx) < 8 ? 'middle' : a.lx > cx ? 'start' : 'end'} dominantBaseline="middle">
              {a.label}
            </text>
          </g>
        ))}
      </svg>

      {hover !== null && (
        <Tooltip px={ptr.px} py={ptr.py}>
          <strong>{axes[hover].label}</strong>
          <br />
          {fmt(axes[hover].value, axes[hover].value < 10 ? 1 : 0)} / {fmt(axes[hover].optimal)} {axes[hover].unit}
          <br />
          <span style={{ color: axes[hover].pct >= 100 ? C.accent2 : C.warn }}>{fmt(axes[hover].pct)} % de l'objectif</span>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut macros (moyenne/jour)
// ---------------------------------------------------------------------------

function MacroDonut({ totals }: { totals: { proteines: number; glucides: number; lipides: number; kcal: number } }) {
  const [hover, setHover] = useState<number | null>(null);
  const parts = [
    { key: 'proteines', label: 'Protéines', kcal: totals.proteines * 4, grams: totals.proteines, color: C.accent },
    { key: 'glucides', label: 'Glucides', kcal: totals.glucides * 4, grams: totals.glucides, color: C.warn },
    { key: 'lipides', label: 'Lipides', kcal: totals.lipides * 9, grams: totals.lipides, color: C.danger },
  ];
  const totalKcal = parts.reduce((a, p) => a + p.kcal, 0);

  if (totalKcal <= 0) {
    return <div className="empty">Aucune donnée sur la période.</div>;
  }

  const W = 320;
  const H = 300;
  const cx = W / 2;
  const cy = H / 2;

  const pieGen = d3pie<(typeof parts)[number]>().value((d) => d.kcal).sort(null);
  const arcs = pieGen(parts);
  const arcGen = d3arc<(typeof arcs)[number]>().innerRadius(60).outerRadius(110).padAngle(0.02).cornerRadius(3);
  const arcHover = d3arc<(typeof arcs)[number]>().innerRadius(60).outerRadius(118).padAngle(0.02).cornerRadius(3);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 320, display: 'block' }}>
        <g transform={`translate(${cx},${cy})`}>
          {arcs.map((a, i) => (
            <path
              key={parts[i].key}
              d={(hover === i ? arcHover : arcGen)(a)!}
              fill={parts[i].color}
              opacity={hover === null || hover === i ? 1 : 0.45}
              style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
          <text textAnchor="middle" dominantBaseline="middle" y={-6} fill={C.text} fontSize={22} fontWeight={700}>
            {hover === null ? fmt(totalKcal) : fmt(parts[hover].kcal)}
          </text>
          <text textAnchor="middle" dominantBaseline="middle" y={16} fill={C.muted} fontSize={12}>
            {hover === null ? 'kcal/j (macros)' : `${fmt((parts[hover].kcal / totalKcal) * 100)} % · ${parts[hover].label}`}
          </text>
        </g>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 140 }}>
        {parts.map((p, i) => (
          <div key={p.key} className="row" style={{ gap: 8, cursor: 'pointer', opacity: hover === null || hover === i ? 1 : 0.5 }} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: p.color, display: 'inline-block' }} />
            <span style={{ flex: 1 }}>{p.label}</span>
            <span className="mono small">
              {fmt(p.grams)} g · {fmt((p.kcal / totalKcal) * 100)} %
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip partagé
// ---------------------------------------------------------------------------

function Tooltip({ px, py, children }: { px: number; py: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${px}%`,
        top: `${py}%`,
        transform: `translate(${px > 65 ? '-100%' : '-50%'}, -115%)`,
        background: C.panel2,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '6px 9px',
        fontSize: 12,
        color: C.text,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 5,
        boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
      }}
    >
      {children}
    </div>
  );
}
