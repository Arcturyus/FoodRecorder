import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { useStore, useEffectiveFoods } from '../store/store';
import type { JournalEntry } from '../store/store';
import { normalize } from '../nutrition/normalize';
import { foodFrequencies, foodPairFrequencies, occurrencesByDate } from '../nutrition/frequency';
import type { FoodFrequency } from '../nutrition/frequency';
import type { Food, FoodCategory } from '../nutrition/types';
import {
  PeriodSelector,
  resolveRange,
  datesInRange,
  rangeDays,
  defaultPeriodState,
} from './PeriodSelector';
import type { PeriodState } from './PeriodSelector';
import { fmt, CATEGORY_LABELS } from './format';

/**
 * Mode « Consommation » de l'onglet Aliments : ce que VOUS mangez réellement
 * (fréquences sur le journal), par opposition aux autres modes qui décrivent
 * la banque d'aliments. Classement + détail « quand » par aliment.
 */

/** Palette alignée sur les variables CSS du thème (mêmes valeurs que Stats). */
const C = {
  accent: '#5b8cff',
  border: '#2a2f3a',
  panel2: '#1f232c',
  text: '#e6e8ec',
};

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Métriques de classement proposées (« le plus mangé » a plusieurs sens). */
const FREQ_METRICS = [
  { key: 'occurrences', label: 'Fois consommé', unit: '×', hint: 'Nombre de consommations (plusieurs par jour possibles).' },
  { key: 'jours', label: 'Jours différents', unit: ' j', hint: 'Nombre de jours distincts où l’aliment a été mangé.' },
  { key: 'grammes', label: 'Quantité', unit: ' g', hint: 'Masse cumulée consommée sur la période.' },
  { key: 'kcal', label: 'Calories', unit: ' kcal', hint: 'Calories cumulées apportées sur la période.' },
] as const;

type FreqMetric = (typeof FREQ_METRICS)[number]['key'];

const TOP_N = 15;

function freqValue(f: FoodFrequency, metric: FreqMetric): number {
  return f[metric];
}

function fmtFreqValue(v: number, metric: FreqMetric): string {
  const unit = FREQ_METRICS.find((m) => m.key === metric)!.unit;
  return `${fmt(v)}${unit}`;
}

/**
 * Point d'entrée du mode : période, case « sans les suppléments » (la créatine
 * quotidienne écraserait tous les classements), puis le panneau.
 */
type ConsoMode = 'classement' | 'ensemble';

export function FoodConsumption() {
  const entries = useStore((s) => s.entries);
  const foods = useEffectiveFoods();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriodState);
  const [excludeSupplements, setExcludeSupplements] = useState(true);
  const [mode, setMode] = useState<ConsoMode>('classement');

  /** 1re date enregistrée (borne « Tout »). */
  const earliest = useMemo(() => {
    let min: string | undefined;
    for (const e of entries) if (min === undefined || e.date < min) min = e.date;
    return min;
  }, [entries]);
  const range = useMemo(() => resolveRange(period, earliest), [period, earliest]);
  const days = rangeDays(range);

  const supplementIds = useMemo(
    () => new Set(foods.filter((f) => f.categorie === 'supplement').map((f) => f.id)),
    [foods],
  );
  const freqEntries = useMemo(
    () =>
      excludeSupplements
        ? entries
            .map((e) => ({ ...e, items: e.items.filter((it) => !(it.foodId && supplementIds.has(it.foodId))) }))
            .filter((e) => e.items.length > 0)
        : entries,
    [entries, excludeSupplements, supplementIds],
  );

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Ma consommation</h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8 }}>
        <button className={`ghost small ${mode === 'classement' ? 'chip-active' : ''}`} onClick={() => setMode('classement')}>
          Classement
        </button>
        <button className={`ghost small ${mode === 'ensemble' ? 'chip-active' : ''}`} onClick={() => setMode('ensemble')}>
          Mangés ensemble
        </button>
      </div>
      <div className="row" style={{ alignItems: 'center', marginTop: 10 }}>
        <label
          className="row small"
          style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
          title="Retire les compléments et assaisonnements (créatine, whey, sel…) du classement : pris tous les jours, ils écraseraient le haut du tableau."
        >
          <input
            type="checkbox"
            checked={excludeSupplements}
            onChange={(e) => setExcludeSupplements(e.target.checked)}
          />
          Sans les suppléments
        </label>
      </div>
      {mode === 'classement' ? (
        <>
          <p className="small" style={{ marginTop: 2 }}>
            Classement sur la période, d'après votre journal. Cliquez un aliment pour voir <em>quand</em> vous l'avez
            mangé.
          </p>
          <FoodFrequencyPanel entries={freqEntries} range={range} days={days} foods={foods} />
        </>
      ) : (
        <>
          <p className="small" style={{ marginTop: 2 }}>
            Paires d'aliments qui reviennent dans une même requête (même repas saisi), classées par nombre de fois
            mangées ensemble.
          </p>
          <FoodPairsPanel entries={freqEntries} range={range} />
        </>
      )}
    </div>
  );
}

/** Info-bulle riche d'un aliment (toutes les métriques d'un coup). */
function FrequencyCard({ f, days }: { f: FoodFrequency; days: number }) {
  return (
    <div style={{ maxWidth: 240 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>{f.nom}</strong>
        <span className="hc-badge" style={{ background: 'rgba(91,140,255,0.18)', color: 'var(--accent)' }}>
          {fmt(f.occurrences)}×
        </span>
      </div>
      <div className="hc-rows" style={{ marginTop: 8 }}>
        <div><span>Jours différents</span><span className="mono">{fmt(f.jours)} / {fmt(days)} j</span></div>
        <div><span>Quantité totale</span><span className="mono">{fmt(f.grammes)} g</span></div>
        <div><span>Calories totales</span><span className="mono">{fmt(f.kcal)} kcal</span></div>
        <div><span>Dernière fois</span><span className="mono">{dayLabel(f.derniere)}</span></div>
      </div>
      {f.foodId === null && (
        <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>
          Aliment sans correspondance dans la base (estimé ou libre).
        </div>
      )}
      <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>Cliquez pour voir quand</div>
    </div>
  );
}

/**
 * Classement des aliments les plus consommés sur la période, et détail « quand »
 * pour l'aliment sélectionné. Une seule couleur : le rang est porté par la
 * longueur de la barre et l'ordre, jamais par la teinte.
 */
function FoodFrequencyPanel({
  entries,
  range,
  days,
  foods,
}: {
  entries: JournalEntry[];
  range: { start: string; end: string };
  days: number;
  foods: Food[];
}) {
  const [metric, setMetric] = useState<FreqMetric>('occurrences');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tip, setTip] = useState<{ f: FoodFrequency; x: number; y: number } | null>(null);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<FoodCategory | 'all'>('all');
  const [showAll, setShowAll] = useState(false);

  const categoryById = useMemo(() => new Map(foods.map((f) => [f.id, f.categorie])), [foods]);
  const freqs = useMemo(() => foodFrequencies(entries, range), [entries, range]);
  const q = normalize(query);
  const filtered = useMemo(
    () =>
      freqs.filter((f) => {
        if (cat !== 'all' && (f.foodId === null || categoryById.get(f.foodId) !== cat)) return false;
        if (q && !normalize(f.nom).includes(q)) return false;
        return true;
      }),
    [freqs, cat, q, categoryById],
  );
  const ranked = useMemo(
    () => [...filtered].sort((a, b) => freqValue(b, metric) - freqValue(a, metric) || a.nom.localeCompare(b.nom, 'fr')),
    [filtered, metric],
  );
  const shown = showAll ? ranked : ranked.slice(0, TOP_N);
  const maxVal = shown.length > 0 ? freqValue(shown[0], metric) : 0;
  const open = openKey ? freqs.find((f) => f.key === openKey) ?? null : null;

  if (freqs.length === 0) {
    return <div className="empty">Aucun aliment enregistré sur cette période.</div>;
  }

  return (
    <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FREQ_METRICS.map((m) => (
          <button
            key={m.key}
            className={`small ${metric === m.key ? 'chip-active' : 'ghost'}`}
            onClick={() => setMetric(m.key)}
            title={m.hint}
          >
            {m.label}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Rechercher un aliment…"
        style={{ width: '100%', marginBottom: 8 }}
      />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button className={`ghost small ${cat === 'all' ? 'chip-active' : ''}`} onClick={() => setCat('all')}>
          Tout
        </button>
        {CATEGORY_LABELS.map((c) => (
          <button
            key={c.key}
            className={`ghost small ${cat === c.key ? 'chip-active' : ''}`}
            onClick={() => setCat((v) => (v === c.key ? 'all' : c.key))}
          >
            {c.label}
          </button>
        ))}
      </div>

      {ranked.length === 0 ? (
        <div className="empty">Aucun aliment ne correspond à ces filtres.</div>
      ) : (
        <>
          {shown.map((f) => {
            const v = freqValue(f, metric);
            return (
              <div
                className={`cov-row${openKey === f.key ? ' sel' : ''}`}
                key={f.key}
                onClick={() => setOpenKey((prev) => (prev === f.key ? null : f.key))}
                onMouseMove={(e) => setTip({ f, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTip((prev) => (prev?.f.key === f.key ? null : prev))}
              >
                <span className="cov-label" title={f.nom}>
                  {openKey === f.key && <span style={{ color: 'var(--accent)' }}>● </span>}
                  {f.nom}
                </span>
                <div className="bar">
                  <span style={{ width: `${maxVal > 0 ? (v / maxVal) * 100 : 0}%` }} />
                </div>
                <span className="mono small" style={{ textAlign: 'right' }}>
                  {fmtFreqValue(v, metric)}
                </span>
              </div>
            );
          })}

          {ranked.length > TOP_N && (
            <button className="ghost small" style={{ marginTop: 4 }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? '− Réduire' : `+ Voir les ${ranked.length - TOP_N} autre(s)`}
            </button>
          )}
        </>
      )}

      {open && <FrequencyDetail f={open} entries={entries} range={range} days={days} />}

      {tip && (
        <FollowTip x={tip.x} y={tip.y}>
          <FrequencyCard f={tip.f} days={days} />
        </FollowTip>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Mode « Mangés ensemble » : paires d'aliments qui reviennent dans la même requête
// ---------------------------------------------------------------------------

const PAIR_TOP_N = 20;

function FoodPairsPanel({ entries, range }: { entries: JournalEntry[]; range: { start: string; end: string } }) {
  const [showAll, setShowAll] = useState(false);
  const pairs = useMemo(() => foodPairFrequencies(entries, range), [entries, range]);
  const shown = showAll ? pairs : pairs.slice(0, PAIR_TOP_N);
  const maxCount = pairs.length > 0 ? pairs[0].count : 0;

  if (pairs.length === 0) {
    return <div className="empty">Pas encore assez de repas avec plusieurs aliments pour voir des paires.</div>;
  }

  return (
    <>
      {shown.map((p) => (
        <div className="cov-row" key={p.key}>
          <span className="cov-label" title={`${p.nomA} + ${p.nomB}`}>
            {p.nomA} + {p.nomB}
          </span>
          <div className="bar">
            <span style={{ width: `${maxCount > 0 ? (p.count / maxCount) * 100 : 0}%` }} />
          </div>
          <span className="mono small" style={{ textAlign: 'right' }}>
            {fmt(p.count)}×
          </span>
        </div>
      ))}

      {pairs.length > PAIR_TOP_N && (
        <button className="ghost small" style={{ marginTop: 4 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? '− Réduire' : `+ Voir les ${pairs.length - PAIR_TOP_N} autre(s)`}
        </button>
      )}
    </>
  );
}

/** Détail « quand ai-je mangé ça ? » : une marque par jour de la période. */
function FrequencyDetail({
  f,
  entries,
  range,
  days,
}: {
  f: FoodFrequency;
  entries: JournalEntry[];
  range: { start: string; end: string };
  days: number;
}) {
  const counts = useMemo(() => occurrencesByDate(f, entries), [f, entries]);
  const dates = useMemo(() => datesInRange(range), [range]);
  const maxCount = Math.max(1, ...counts.values());

  const W = 720;
  const H = 90;
  const padX = 4;
  const padBottom = 18;
  const x = scaleLinear().domain([0, Math.max(1, dates.length - 1)]).range([padX, W - padX]);
  const barW = Math.max(2, Math.min(14, (W - 2 * padX) / Math.max(1, dates.length) - 2));

  const [hover, setHover] = useState<{ date: string; n: number; px: number } | null>(null);

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong>{f.nom}</strong>
        <span className="small mono">
          {fmt(f.occurrences)} fois · {fmt(f.jours)} jour(s) sur {fmt(days)} · dernière fois {dayLabel(f.derniere)}
        </span>
      </div>
      <p className="small" style={{ margin: '4px 0 8px' }}>
        Une barre par jour de consommation ({fmt(f.jours)} jour(s) sur {fmt(days)}, soit en moyenne{' '}
        {f.jours > 0 ? `1 fois tous les ${fmt(days / f.jours, 1)} jours` : 'jamais'}).
      </p>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
          <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom} stroke={C.border} strokeWidth={1} />
          {dates.map((d, i) => {
            const n = counts.get(d) ?? 0;
            if (n === 0) return null;
            const h = ((H - padBottom - 8) * n) / maxCount;
            return (
              <rect
                key={d}
                x={x(i) - barW / 2}
                y={H - padBottom - h}
                width={barW}
                height={h}
                rx={2}
                fill={C.accent}
                onMouseEnter={() => setHover({ date: d, n, px: (x(i) / W) * 100 })}
                onMouseLeave={() => setHover(null)}
              />
            );
          })}
        </svg>
        {hover && (
          <div
            style={{
              position: 'absolute',
              left: `${hover.px}%`,
              top: '30%',
              transform: `translate(${hover.px > 65 ? '-100%' : '-50%'}, -115%)`,
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
            {dayLabel(hover.date)} · {hover.n}×
          </div>
        )}
      </div>
      <div className="row small" style={{ justifyContent: 'space-between', opacity: 0.7 }}>
        <span>{dayLabel(range.start)}</span>
        <span>{dayLabel(range.end)}</span>
      </div>
    </div>
  );
}

/** Info-bulle flottante qui suit le curseur, bornée pour ne pas déborder de l'écran. */
function FollowTip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  const margin = 150;
  const left = Math.min(Math.max(x, margin), (typeof window !== 'undefined' ? window.innerWidth : 1024) - margin);
  return (
    <div className="follow-tip" style={{ left, top: y - 16 }}>
      {children}
    </div>
  );
}
