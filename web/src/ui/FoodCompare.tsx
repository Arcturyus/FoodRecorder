import { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { extent } from 'd3-array';
import { RDA } from '../nutrition/rda';
import { NUTRIENT_GROUPS } from '../nutrition/groups';
import { portionGrams, effectiveImportance } from '../nutrition/recommend';
import { pca2 } from '../nutrition/pca';
import { normalize } from '../nutrition/normalize';
import { useStore } from '../store/store';
import type { Food, FoodCategory, NutrientKey } from '../nutrition/types';
import { CATS, COLOR_BY_CAT } from './FoodExplorer';
import { fmt } from './format';

/**
 * Mode « Comparer » : met deux aliments face à face (barres divergentes, radar,
 * voisins/substituts) et les situe dans une carte ACP de toute la banque. Trois
 * normalisations (100 kcal, 100 g, portion) et une pondération optionnelle par
 * l'importance des nutriments (les mêmes curseurs que l'onglet Nutriments).
 */

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

/** Couleurs des deux emplacements comparés (A / B). */
const SLOT_COLOR = ['#5b8cff', '#f5a623'] as const;

/** Nutriments comparables : tout sauf les calories (constantes en densité /100 kcal). */
const NUT = RDA.filter((r) => r.key !== 'kcal').map((r) => ({ key: r.key, label: r.label, unit: r.unit }));
const NUT_LABEL = new Map(NUT.map((n) => [n.key, n.label]));
const NUT_UNIT = new Map(NUT.map((n) => [n.key, n.unit]));
const COMPARABLE_KEYS = NUT.map((n) => n.key);

/** Jeu de nutriments actifs par défaut : un représentant lisible par famille. */
const DEFAULT_ACTIVE: NutrientKey[] = [
  'proteines', 'fibres', 'agSatures', 'omega3', 'fer', 'magnesium',
  'calcium', 'potassium', 'zinc', 'vitC', 'vitD', 'vitB12',
];

type NormMode = '100kcal' | '100g' | 'portion';
const NORM_LABELS: Record<NormMode, string> = {
  '100kcal': 'pour 100 kcal',
  '100g': 'pour 100 g',
  portion: 'par portion',
};

/** Valeur d'un nutriment selon la normalisation choisie. */
function normalizedValue(food: Food, key: NutrientKey, mode: NormMode): number {
  const per100g = food.n[key] ?? 0;
  if (mode === '100g') return per100g;
  if (mode === '100kcal') {
    const kcal = food.n.kcal;
    return kcal > 0 ? per100g * (100 / kcal) : 0;
  }
  return per100g * (portionGrams(food) / 100);
}

export function FoodCompare({
  foods,
  ids,
  setIds,
}: {
  foods: Food[];
  ids: [string | null, string | null];
  setIds: (ids: [string | null, string | null]) => void;
}) {
  const overrides = useStore((s) => s.nutrientImportance);
  const [mode, setMode] = useState<NormMode>('100kcal');
  const [weighted, setWeighted] = useState(true);
  const [active, setActive] = useState<NutrientKey[]>(DEFAULT_ACTIVE);
  const [showArrows, setShowArrows] = useState(true);
  const [hideCats, setHideCats] = useState<Set<FoodCategory>>(new Set());

  const byId = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);
  const foodA = ids[0] ? byId.get(ids[0]) ?? null : null;
  const foodB = ids[1] ? byId.get(ids[1]) ?? null : null;

  const activeSet = useMemo(() => new Set(active), [active]);
  const activeKeys = useMemo(() => COMPARABLE_KEYS.filter((k) => activeSet.has(k)), [activeSet]);

  /** Poids par nutriment actif : importance si pondération activée, sinon 1. */
  const weightFor = useMemo(
    () => (k: NutrientKey) => (weighted ? effectiveImportance(k, overrides) : 1),
    [weighted, overrides],
  );

  const setSlot = (slot: 0 | 1, id: string | null) => {
    const next: [string | null, string | null] = [ids[0], ids[1]];
    next[slot] = id;
    setIds(next);
  };

  const toggleKey = (k: NutrientKey) =>
    setActive((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));

  return (
    <>
      <div className="panel">
        <p className="small" style={{ marginTop: 0 }}>
          Comparez deux aliments nutriment par nutriment, puis situez-les dans la carte de toute la banque. Choisissez la
          base de comparaison et, si vous voulez, laissez vos <strong>importances</strong> pondérer proximité et carte.
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <FoodPicker slot={0} food={foodA} foods={foods} onPick={(id) => setSlot(0, id)} />
          <FoodPicker slot={1} food={foodB} foods={foods} onPick={(id) => setSlot(1, id)} />
        </div>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small" style={{ color: C.muted }}>Base :</span>
          {(Object.keys(NORM_LABELS) as NormMode[]).map((m) => (
            <button key={m} className={`ghost small ${mode === m ? 'chip-active' : ''}`} onClick={() => setMode(m)}>
              {NORM_LABELS[m]}
            </button>
          ))}
          <span style={{ width: 12 }} />
          <label className="row small" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }} data-tip="Pondère proximité, voisins et carte par vos curseurs d'importance (créatine à ×0 ne compte plus, oméga 3 à ×2 compte double).">
            <input type="checkbox" checked={weighted} onChange={(e) => setWeighted(e.target.checked)} />
            Pondérer par mes importances
          </label>
        </div>
      </div>

      {!foodA || !foodB ? (
        <div className="panel">
          <div className="empty">Choisissez deux aliments à comparer.</div>
        </div>
      ) : (
        <>
          <NutrientChips active={activeSet} onToggle={toggleKey} setActive={setActive} />
          <DivergentBars a={foodA} b={foodB} keys={activeKeys} mode={mode} />
          <RadarCompare a={foodA} b={foodB} keys={activeKeys} mode={mode} />
        </>
      )}

      {(foodA || foodB) && (
        <NeighborsPanel
          foods={foods}
          a={foodA}
          b={foodB}
          activeKeys={activeKeys}
          mode={mode}
          weightFor={weightFor}
          onPick={setSlot}
        />
      )}

      <PcaBiplot
        foods={foods}
        activeKeys={activeKeys}
        mode={mode}
        weightFor={weightFor}
        selected={[foodA, foodB]}
        showArrows={showArrows}
        setShowArrows={setShowArrows}
        hideCats={hideCats}
        setHideCats={setHideCats}
        onPick={setSlot}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sélecteur d'aliment (recherche + liste déroulante) par emplacement
// ---------------------------------------------------------------------------

function FoodPicker({
  slot,
  food,
  foods,
  onPick,
}: {
  slot: 0 | 1;
  food: Food | null;
  foods: Food[];
  onPick: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const q = normalize(query);
  const matches = useMemo(() => {
    if (!q) return [];
    return foods
      .filter((f) => normalize(f.nom).includes(q) || f.aliases.some((a) => normalize(a).includes(q)))
      .slice(0, 8);
  }, [foods, q]);

  return (
    <div className="field" style={{ flex: '1 1 220px', minWidth: 200, position: 'relative' }}>
      <span className="small" style={{ color: SLOT_COLOR[slot], fontWeight: 600 }}>
        {slot === 0 ? 'Aliment A' : 'Aliment B'}
      </span>
      {food ? (
        <div className="row" style={{ gap: 6, alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ borderLeft: `3px solid ${SLOT_COLOR[slot]}`, paddingLeft: 8 }}>{food.nom}</span>
          <button className="ghost small" onClick={() => onPick(null)} data-tip="Changer">
            ✕
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Rechercher un aliment…"
          />
          {open && matches.length > 0 && (
            <div className="compare-dropdown">
              {matches.map((f) => (
                <button
                  key={f.id}
                  className="compare-option"
                  onClick={() => {
                    onPick(f.id);
                    setQuery('');
                    setOpen(false);
                  }}
                >
                  {f.nom} <span className="small" style={{ color: C.muted }}>· {fmt(f.n.kcal)} kcal</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips de sélection des nutriments actifs (groupés par famille)
// ---------------------------------------------------------------------------

function NutrientChips({
  active,
  onToggle,
  setActive,
}: {
  active: Set<NutrientKey>;
  onToggle: (k: NutrientKey) => void;
  setActive: (keys: NutrientKey[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Nutriments comparés ({active.size})</h2>
        <div className="row" style={{ gap: 6 }}>
          <button className="ghost small" onClick={() => setActive(DEFAULT_ACTIVE)}>Défaut</button>
          <button className="ghost small" onClick={() => setActive(COMPARABLE_KEYS)}>Tout</button>
          <button className="ghost small" onClick={() => setActive([])}>Aucun</button>
          <button className="ghost small" onClick={() => setOpen((v) => !v)}>{open ? 'Réduire' : 'Choisir'}</button>
        </div>
      </div>
      {open && (
        <div style={{ marginTop: 8 }}>
          {NUTRIENT_GROUPS.map((g) => {
            const keys = g.keys.filter((k) => k !== 'kcal' && NUT_LABEL.has(k));
            if (keys.length === 0) return null;
            return (
              <div key={g.title} style={{ marginTop: 8 }}>
                <div className="small" style={{ color: C.muted, marginBottom: 4 }}>{g.title}</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {keys.map((k) => (
                    <button
                      key={k}
                      className={`ghost small ${active.has(k) ? 'chip-active' : ''}`}
                      onClick={() => onToggle(k)}
                    >
                      {NUT_LABEL.get(k)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barres divergentes : écart A vs B nutriment par nutriment (log-ratio)
// ---------------------------------------------------------------------------

/** Rapport max affiché avant de basculer sur « présent d'un seul côté » (log2 = 4 → ×16). */
const RATIO_CAP = 4;

function DivergentBars({ a, b, keys, mode }: { a: Food; b: Food; keys: NutrientKey[]; mode: NormMode }) {
  const rows = useMemo(() => {
    const eps = 1e-6;
    return keys
      .map((k) => {
        const va = normalizedValue(a, k, mode);
        const vb = normalizedValue(b, k, mode);
        // « Présent d'un seul côté » : l'un est nul, l'autre non → rapport « infini », affiché plafonné.
        const onlyOne = (va > 0) !== (vb > 0);
        // log2 du rapport : 0 = égalité, +1 = A double de B, −1 = B double de A.
        const ratio = Math.log2((va + eps) / (vb + eps));
        const clamped = Math.max(-RATIO_CAP, Math.min(RATIO_CAP, ratio));
        return { k, va, vb, ratio, clamped, onlyOne, both: va + vb };
      })
      .filter((r) => r.both > 0)
      .sort((x, y) => y.ratio - x.ratio);
  }, [a, b, keys, mode]);

  if (rows.length === 0) {
    return (
      <div className="panel">
        <div className="empty">Aucun nutriment actif avec des données pour ces deux aliments.</div>
      </div>
    );
  }

  const W = 680;
  const rowH = 22;
  const H = rows.length * rowH + 16;
  const mid = W / 2;
  const half = W / 2 - 130;
  // Échelle fixe (plafond) : une différence « infinie » ne compresse plus les écarts finis lisibles.
  const scale = (r: number) => (r / RATIO_CAP) * half;

  return (
    <div className="panel">
      <h2 style={{ fontSize: 15 }}>Écarts nutriment par nutriment</h2>
      <p className="small" style={{ marginTop: -4 }}>
        Barre vers <span style={{ color: SLOT_COLOR[0] }}>■ {a.nom}</span> ou{' '}
        <span style={{ color: SLOT_COLOR[1] }}>■ {b.nom}</span> selon qui est le plus riche ({NORM_LABELS[mode]}).
        Les nutriments proches du centre sont similaires ; les extrêmes marquent les grosses différences. Échelle en
        log₂ du rapport (un cran = ×2).
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
        <line x1={mid} x2={mid} y1={8} y2={H - 8} stroke={C.border} strokeWidth={1} />
        {rows.map((r, i) => {
          const y = 8 + i * rowH + rowH / 2;
          const len = scale(r.clamped);
          const toA = r.clamped >= 0;
          const color = toA ? SLOT_COLOR[0] : SLOT_COLOR[1];
          const unit = NUT_UNIT.get(r.k);
          const mult = r.onlyOne ? 'seul' : `×${fmt(Math.pow(2, Math.abs(r.ratio)), 1)}`;
          return (
            <g key={r.k}>
              <rect
                x={toA ? mid : mid + len}
                y={y - 6}
                width={Math.abs(len)}
                height={12}
                fill={color}
                opacity={r.onlyOne ? 0.55 : 0.85}
                rx={2}
                data-tip={`${NUT_LABEL.get(r.k)} — ${a.nom} : ${fmt(r.va, r.va < 10 ? 2 : 0)} ${unit} · ${b.nom} : ${fmt(r.vb, r.vb < 10 ? 2 : 0)} ${unit}`}
              />
              <text x={mid + (toA ? -8 : 8)} y={y} fontSize={11} fill={C.text} textAnchor={toA ? 'end' : 'start'} dominantBaseline="middle">
                {NUT_LABEL.get(r.k)}
              </text>
              <text x={toA ? mid + len + 6 : mid + len - 6} y={y} fontSize={10} fill={C.muted} textAnchor={toA ? 'start' : 'end'} dominantBaseline="middle">
                {mult}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radar : profils superposés (chaque axe normalisé au max des deux aliments)
// ---------------------------------------------------------------------------

function RadarCompare({ a, b, keys, mode }: { a: Food; b: Food; keys: NutrientKey[]; mode: NormMode }) {
  const axes = useMemo(() => {
    return keys
      .map((k) => {
        const va = normalizedValue(a, k, mode);
        const vb = normalizedValue(b, k, mode);
        const max = Math.max(va, vb);
        return { k, va, vb, max };
      })
      .filter((x) => x.max > 0);
  }, [a, b, keys, mode]);

  if (axes.length < 3) {
    return (
      <div className="panel">
        <div className="empty">Activez au moins 3 nutriments avec des données pour tracer le radar.</div>
      </div>
    );
  }

  const size = 460;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 70;
  const n = axes.length;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, frac: number) => [cx + Math.cos(angle(i)) * R * frac, cy + Math.sin(angle(i)) * R * frac];
  const polygon = (pick: (ax: (typeof axes)[number]) => number) =>
    axes.map((ax, i) => point(i, ax.max > 0 ? pick(ax) / ax.max : 0)).map((p) => p.join(',')).join(' ');

  return (
    <div className="panel">
      <h2 style={{ fontSize: 15 }}>Radar des profils</h2>
      <p className="small" style={{ marginTop: -4 }}>
        Chaque axe est mis à l'échelle sur le plus riche des deux ({NORM_LABELS[mode]}) : la forme montre d'un coup
        d'œil où chacun domine. <span style={{ color: SLOT_COLOR[0] }}>■ {a.nom}</span>{' '}
        <span style={{ color: SLOT_COLOR[1] }}>■ {b.nom}</span>.
      </p>
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', maxWidth: 460, display: 'block', margin: '0 auto' }}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon
            key={f}
            points={axes.map((_, i) => point(i, f).join(',')).join(' ')}
            fill="none"
            stroke={C.border}
            strokeWidth={1}
          />
        ))}
        {axes.map((ax, i) => {
          const [x, y] = point(i, 1);
          const [lx, ly] = point(i, 1.16);
          return (
            <g key={ax.k}>
              <line x1={cx} y1={cy} x2={x} y2={y} stroke={C.border} strokeWidth={1} />
              <text x={lx} y={ly} fontSize={10} fill={C.muted} textAnchor="middle" dominantBaseline="middle">
                {NUT_LABEL.get(ax.k)}
              </text>
            </g>
          );
        })}
        <polygon points={polygon((ax) => ax.va)} fill={SLOT_COLOR[0]} fillOpacity={0.25} stroke={SLOT_COLOR[0]} strokeWidth={2} />
        <polygon points={polygon((ax) => ax.vb)} fill={SLOT_COLOR[1]} fillOpacity={0.2} stroke={SLOT_COLOR[1]} strokeWidth={2} />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voisins (substituts) & complémentaires
// ---------------------------------------------------------------------------

/** Vecteurs standardisés (z-score, pondérés) de la banque sur les nutriments actifs. */
function useStandardized(foods: Food[], keys: NutrientKey[], mode: NormMode, weightFor: (k: NutrientKey) => number) {
  return useMemo(() => {
    const n = foods.length;
    const m = keys.length;
    const raw: number[][] = foods.map((f) => keys.map((k) => normalizedValue(f, k, mode)));
    const z: number[][] = raw.map(() => new Array(m).fill(0));
    const colMax = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      const col = raw.map((r) => r[j]);
      const mean = col.reduce((a, x) => a + x, 0) / (n || 1);
      const std = Math.sqrt(col.reduce((a, x) => a + (x - mean) * (x - mean), 0) / (n || 1));
      const w = Math.sqrt(Math.max(0, weightFor(keys[j])));
      colMax[j] = Math.max(...col, 0);
      for (let i = 0; i < n; i++) z[i][j] = std > 1e-9 ? ((col[i] - mean) / std) * w : 0;
    }
    return { z, raw, colMax, index: new Map(foods.map((f, i) => [f.id, i])) };
  }, [foods, keys, mode, weightFor]);
}

function NeighborsPanel({
  foods,
  a,
  b,
  activeKeys,
  mode,
  weightFor,
  onPick,
}: {
  foods: Food[];
  a: Food | null;
  b: Food | null;
  activeKeys: NutrientKey[];
  mode: NormMode;
  weightFor: (k: NutrientKey) => number;
  onPick: (slot: 0 | 1, id: string) => void;
}) {
  const std = useStandardized(foods, activeKeys, mode, weightFor);

  const neighborsOf = (food: Food, otherSlot: 0 | 1) => {
    const i = std.index.get(food.id);
    if (i == null || activeKeys.length === 0) return null;
    const zi = std.z[i];
    const lowMask = std.raw[i].map((v, j) => 1 - (std.colMax[j] > 0 ? v / std.colMax[j] : 0));
    const scored = foods.map((f, k) => {
      if (k === i) return null;
      const zk = std.z[k];
      let dist = 0;
      let compl = 0;
      for (let j = 0; j < zi.length; j++) {
        const d = zi[j] - zk[j];
        dist += d * d;
        // Complémentarité : f est riche (valeur normalisée haute) là où `food` est pauvre.
        compl += (std.colMax[j] > 0 ? std.raw[k][j] / std.colMax[j] : 0) * lowMask[j] * Math.max(0, weightFor(activeKeys[j]));
      }
      return { f, dist: Math.sqrt(dist), compl };
    }).filter((x): x is { f: Food; dist: number; compl: number } => x !== null);

    const substitutes = [...scored].sort((x, y) => x.dist - y.dist).slice(0, 5);
    const complements = [...scored].sort((x, y) => y.compl - x.compl).slice(0, 5);
    return { substitutes, complements, otherSlot };
  };

  const blocks = [a ? { food: a, slot: 0 as const } : null, b ? { food: b, slot: 1 as const } : null].filter(
    (x): x is { food: Food; slot: 0 | 1 } => x !== null,
  );

  if (blocks.length === 0 || activeKeys.length === 0) return null;

  return (
    <div className="panel">
      <h2 style={{ fontSize: 15 }}>Substituts &amp; compléments</h2>
      <p className="small" style={{ marginTop: -4 }}>
        <strong>Substituts</strong> = profils les plus proches (par quoi remplacer sans trop changer).{' '}
        <strong>Compléments</strong> = riches là où l'aliment est pauvre (bons duos). Cliquez pour charger dans
        l'emplacement opposé.
      </p>
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {blocks.map(({ food, slot }) => {
          const res = neighborsOf(food, slot === 0 ? 1 : 0);
          if (!res) return null;
          return (
            <div key={slot} style={{ flex: '1 1 260px', minWidth: 240 }}>
              <div className="small" style={{ color: SLOT_COLOR[slot], fontWeight: 600, marginBottom: 6 }}>
                {food.nom}
              </div>
              <div className="small" style={{ color: C.muted, margin: '4px 0 2px' }}>Substituts</div>
              {res.substitutes.map((s) => (
                <button
                  key={s.f.id}
                  className="compare-neighbor"
                  onClick={() => onPick(res.otherSlot, s.f.id)}
                  data-tip={`Distance ${fmt(s.dist, 2)} · charger dans l'emplacement ${res.otherSlot === 0 ? 'A' : 'B'}`}
                >
                  <span>{s.f.nom}</span>
                  <span className="mono small" style={{ color: C.muted }}>{fmt(s.dist, 2)}</span>
                </button>
              ))}
              <div className="small" style={{ color: C.muted, margin: '8px 0 2px' }}>Compléments</div>
              {res.complements.map((s) => (
                <button
                  key={s.f.id}
                  className="compare-neighbor"
                  onClick={() => onPick(res.otherSlot, s.f.id)}
                  data-tip={`Complémentarité ${fmt(s.compl, 2)} · charger dans l'emplacement ${res.otherSlot === 0 ? 'A' : 'B'}`}
                >
                  <span>{s.f.nom}</span>
                  <span className="mono small" style={{ color: C.accent2 }}>+{fmt(s.compl, 1)}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Biplot ACP : carte de toute la banque + flèches nutriments
// ---------------------------------------------------------------------------

function PcaBiplot({
  foods,
  activeKeys,
  mode,
  weightFor,
  selected,
  showArrows,
  setShowArrows,
  hideCats,
  setHideCats,
  onPick,
}: {
  foods: Food[];
  activeKeys: NutrientKey[];
  mode: NormMode;
  weightFor: (k: NutrientKey) => number;
  selected: [Food | null, Food | null];
  showArrows: boolean;
  setShowArrows: (v: boolean) => void;
  hideCats: Set<FoodCategory>;
  setHideCats: (s: Set<FoodCategory>) => void;
  onPick: (slot: 0 | 1, id: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ id: string; px: number; py: number } | null>(null);

  // Carte calculée sur la banque hors compléments (concentrés qui écraseraient les axes),
  // en ré-injectant les 2 aliments sélectionnés même s'ils sont des compléments.
  const bank = useMemo(() => {
    const base = foods.filter((f) => f.categorie !== 'supplement');
    const ids = new Set(base.map((f) => f.id));
    for (const s of selected) if (s && !ids.has(s.id)) base.push(s);
    return base;
  }, [foods, selected]);

  const result = useMemo(() => {
    if (activeKeys.length < 2) return null;
    const matrix = bank.map((f) => activeKeys.map((k) => normalizedValue(f, k, mode)));
    return pca2({
      ids: bank.map((f) => f.id),
      keys: activeKeys,
      matrix,
      weights: activeKeys.map((k) => weightFor(k)),
    });
  }, [bank, activeKeys, mode, weightFor]);

  if (!result) {
    return (
      <div className="panel">
        <div className="empty">Activez au moins 2 nutriments pour tracer la carte ACP.</div>
      </div>
    );
  }

  const W = 680;
  const H = 520;
  const m = { top: 20, right: 20, bottom: 20, left: 20 };
  const foodById = new Map(bank.map((f) => [f.id, f]));
  const selectedIds = new Set(selected.filter((f): f is Food => !!f).map((f) => f.id));

  const visibleScores = result.scores.filter((s) => {
    const f = foodById.get(s.id);
    return f && (!hideCats.has(f.categorie) || selectedIds.has(f.id));
  });

  const [minX, maxX] = extent(result.scores, (s) => s.x) as [number, number];
  const [minY, maxY] = extent(result.scores, (s) => s.y) as [number, number];
  const xs = scaleLinear().domain([minX, maxX]).nice().range([m.left, W - m.right]);
  const ys = scaleLinear().domain([minY, maxY]).nice().range([H - m.bottom, m.top]);

  // Flèches : mises à l'échelle du nuage (les loadings vivent dans un autre repère).
  const scoreR = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)) || 1;
  const loadR = Math.max(1, ...result.loadings.map((l) => Math.hypot(l.x, l.y)));
  const arrowScale = (scoreR / loadR) * 0.85;
  const ax = (v: number) => xs(v * arrowScale);
  const ay = (v: number) => ys(v * arrowScale);
  const originX = xs(0);
  const originY = ys(0);

  const onMove = (e: React.MouseEvent, id: string) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setHover({ id, px: ((e.clientX - rect.left) / rect.width) * 100, py: ((e.clientY - rect.top) / rect.height) * 100 });
  };

  const toggleCat = (key: FoodCategory) => {
    const n = new Set(hideCats);
    n.has(key) ? n.delete(key) : n.add(key);
    setHideCats(n);
  };

  const hoverFood = hover ? foodById.get(hover.id) : null;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Carte ACP de la banque</h2>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`ghost small ${showArrows ? 'chip-active' : ''}`} onClick={() => setShowArrows(!showArrows)}>
            Flèches nutriments
          </button>
        </div>
      </div>
      <p className="small" style={{ marginTop: -4 }}>
        Chaque point = un aliment, projeté sur les 2 axes de plus grande variance des nutriments actifs
        ({NORM_LABELS[mode]}). Deux aliments proches ont des profils proches ; les flèches montrent quels nutriments
        tirent les axes. Cliquez un point pour le charger (A puis B). Variance expliquée :{' '}
        {fmt(result.explained[0] * 100)} % + {fmt(result.explained[1] * 100)} %.
      </p>
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }} onMouseLeave={() => setHover(null)}>
          <line x1={originX} x2={originX} y1={m.top} y2={H - m.bottom} stroke={C.border} strokeWidth={1} opacity={0.6} />
          <line x1={m.left} x2={W - m.right} y1={originY} y2={originY} stroke={C.border} strokeWidth={1} opacity={0.6} />

          {showArrows &&
            result.loadings.map((l) => {
              const x2 = ax(l.x);
              const y2 = ay(l.y);
              if (Math.hypot(l.x, l.y) < loadR * 0.12) return null; // flèches trop courtes : ignorées
              return (
                <g key={l.key} opacity={0.75}>
                  <line x1={originX} y1={originY} x2={x2} y2={y2} stroke={C.accent} strokeWidth={1.2} />
                  <text x={x2} y={y2} fontSize={10} fill={C.accent} textAnchor="middle" dominantBaseline="middle">
                    {NUT_LABEL.get(l.key)}
                  </text>
                </g>
              );
            })}

          {/* Trait entre les deux sélectionnés. */}
          {selected[0] && selected[1] && (() => {
            const sa = result.scores.find((s) => s.id === selected[0]!.id);
            const sb = result.scores.find((s) => s.id === selected[1]!.id);
            if (!sa || !sb) return null;
            return <line x1={xs(sa.x)} y1={ys(sa.y)} x2={xs(sb.x)} y2={ys(sb.y)} stroke={C.muted} strokeWidth={1} strokeDasharray="3 3" />;
          })()}

          {visibleScores.map((s) => {
            const f = foodById.get(s.id)!;
            const sel = selectedIds.has(s.id);
            const slot = selected[0]?.id === s.id ? 0 : selected[1]?.id === s.id ? 1 : null;
            return (
              <circle
                key={s.id}
                cx={xs(s.x)}
                cy={ys(s.y)}
                r={sel ? 7 : 4}
                fill={slot != null ? SLOT_COLOR[slot] : COLOR_BY_CAT.get(f.categorie) ?? C.muted}
                stroke={sel ? C.text : 'none'}
                strokeWidth={sel ? 2 : 0}
                opacity={sel ? 1 : 0.8}
                style={{ cursor: 'pointer' }}
                onMouseMove={(e) => onMove(e, s.id)}
                onClick={() => onPick(selected[0] ? 1 : 0, s.id)}
              />
            );
          })}
        </svg>
        {hover && hoverFood && (
          <div
            style={{
              position: 'absolute',
              left: `${hover.px}%`,
              top: `${hover.py}%`,
              transform: 'translate(-50%, -120%)',
              background: C.panel2,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '5px 8px',
              fontSize: 12,
              color: C.text,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              zIndex: 5,
            }}
          >
            {hoverFood.nom}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {CATS.map((c) => (
          <button
            key={c.key}
            className="ghost small"
            style={{ opacity: hideCats.has(c.key) ? 0.4 : 1, borderColor: hideCats.has(c.key) ? C.border : c.color }}
            onClick={() => toggleCat(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
