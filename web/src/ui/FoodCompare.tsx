import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { extent, quantile } from 'd3-array';
import { RDA } from '../nutrition/rda';
import { NUTRIENT_GROUPS } from '../nutrition/groups';
import { portionGrams, effectiveImportance } from '../nutrition/recommend';
import { pca2 } from '../nutrition/pca';
import { tsne, mds } from '../nutrition/embed';
import { normalize } from '../nutrition/normalize';
import { useStore } from '../store/store';
import type { Food, FoodCategory, NutrientKey } from '../nutrition/types';
import { CATS, COLOR_BY_CAT, rescaleAxis } from './FoodExplorer';
import { fmt } from './format';

/**
 * Mode « Comparer » : met deux aliments face à face (barres divergentes, radar,
 * voisins/substituts) et les situe dans une carte ACP de toute la banque. Trois
 * normalisations (100 kcal, 100 g, portion) et une pondération optionnelle par
 * l'importance des nutriments (les mêmes curseurs que l'onglet Nutriments).
 *
 * Chaque graphe choisit ses propres nutriments (sélecteur compact, replié par
 * défaut, + retrait direct en cliquant un libellé sur les barres / le radar) : les
 * vues ne partagent que la base de comparaison et la pondération.
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
const NUT_RDA = new Map(RDA.map((r) => [r.key, r.rda]));
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

// ---------------------------------------------------------------------------
// Sélection de nutriments par graphique (état local + sélecteur compact)
// ---------------------------------------------------------------------------

/** État d'une sélection de nutriments propre à un graphe (+ ouverture du sélecteur). */
function useNutrientSelection(initial: NutrientKey[]) {
  const [active, setActive] = useState<NutrientKey[]>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const activeSet = useMemo(() => new Set(active), [active]);
  const activeKeys = useMemo(() => COMPARABLE_KEYS.filter((k) => activeSet.has(k)), [activeSet]);
  const toggle = (k: NutrientKey) =>
    setActive((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  return { active, activeSet, activeKeys, setActive, toggle, pickerOpen, setPickerOpen };
}
type NutSel = ReturnType<typeof useNutrientSelection>;

/** Bouton « Choisir les nutriments (n) » à poser dans l'en-tête d'un graphe (mis en avant). */
function NutrientToggle({ sel }: { sel: NutSel }) {
  return (
    <button
      className={`ghost ${sel.pickerOpen ? 'chip-active' : ''}`}
      onClick={() => sel.setPickerOpen(!sel.pickerOpen)}
      style={sel.pickerOpen ? undefined : { borderColor: C.accent, color: C.accent, fontWeight: 600 }}
    >
      ⚙ Choisir les nutriments ({sel.active.length}) {sel.pickerOpen ? '▴' : '▾'}
    </button>
  );
}

/** Bloc de chips groupées par famille, affiché quand le sélecteur du graphe est ouvert. */
function NutrientChipsBlock({ sel, defaultKeys }: { sel: NutSel; defaultKeys: NutrientKey[] }) {
  if (!sel.pickerOpen) return null;
  return (
    <div style={{ marginTop: 8, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8 }}>
      <div className="row" style={{ gap: 6, marginBottom: 4 }}>
        <button className="ghost small" onClick={() => sel.setActive(defaultKeys)}>Défaut</button>
        <button className="ghost small" onClick={() => sel.setActive(COMPARABLE_KEYS)}>Tout</button>
        <button className="ghost small" onClick={() => sel.setActive([])}>Aucun</button>
      </div>
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
                  className={`ghost small ${sel.activeSet.has(k) ? 'chip-active' : ''}`}
                  onClick={() => sel.toggle(k)}
                >
                  {NUT_LABEL.get(k)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** En-tête standard d'un graphe : titre à gauche, bouton nutriments à droite. */
function ChartHeader({ title, sel }: { title: string; sel: NutSel }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
      <NutrientToggle sel={sel} />
    </div>
  );
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
  const [showArrows, setShowArrows] = useState(true);
  const [hideCats, setHideCats] = useState<Set<FoodCategory>>(new Set());

  const byId = useMemo(() => new Map(foods.map((f) => [f.id, f])), [foods]);
  const foodA = ids[0] ? byId.get(ids[0]) ?? null : null;
  const foodB = ids[1] ? byId.get(ids[1]) ?? null : null;

  /** Poids par nutriment : importance si pondération activée, sinon 1. */
  const weightFor = useMemo(
    () => (k: NutrientKey) => (weighted ? effectiveImportance(k, overrides) : 1),
    [weighted, overrides],
  );

  const setSlot = (slot: 0 | 1, id: string | null) => {
    const next: [string | null, string | null] = [ids[0], ids[1]];
    next[slot] = id;
    setIds(next);
  };

  return (
    <>
      <div className="panel">
        <p className="small" style={{ marginTop: 0 }}>
          Comparez deux aliments nutriment par nutriment, puis situez-les dans la carte de toute la banque. Choisissez la
          base de comparaison et, si vous voulez, laissez vos <strong>importances</strong> pondérer proximité et carte.
          Chaque graphe a son propre choix de nutriments.
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
          <DivergentBars a={foodA} b={foodB} mode={mode} />
          <RadarCompare a={foodA} b={foodB} mode={mode} />
        </>
      )}

      {(foodA || foodB) && (
        <NeighborsPanel foods={foods} a={foodA} b={foodB} mode={mode} weightFor={weightFor} onPick={setSlot} />
      )}

      <PcaBiplot
        foods={foods}
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
// Barres divergentes : écart A vs B nutriment par nutriment (log-ratio)
// ---------------------------------------------------------------------------

/** Rapport max affiché avant de basculer sur « présent d'un seul côté » (log2 = 4 → ×16). */
const RATIO_CAP = 4;

function DivergentBars({ a, b, mode }: { a: Food; b: Food; mode: NormMode }) {
  const sel = useNutrientSelection(DEFAULT_ACTIVE);
  const keys = sel.activeKeys;

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
        // Valeur absolue du plus riche + % AJR : dit si l'écart porte sur une quantité
        // significative ou négligeable (×50 sur une trace de magnésium reste une trace).
        const rich = Math.max(va, vb);
        const rda = NUT_RDA.get(k) ?? 0;
        const pct = rda > 0 ? (rich / rda) * 100 : null;
        return { k, va, vb, ratio, clamped, onlyOne, both: va + vb, rich, pct };
      })
      .filter((r) => r.both > 0)
      // A (plus riche, ratio>0) en haut : on lit la liste du plus « pro-A » au plus « pro-B ».
      .sort((x, y) => y.ratio - x.ratio);
  }, [a, b, keys, mode]);

  const W = 680;
  const rowH = 22;
  const H = Math.max(rowH + 16, rows.length * rowH + 16);
  const mid = W / 2;
  // Marge élargie côté barre : la valeur brute + % AJR s'affichent avec le ×N, du
  // côté de l'aliment le plus riche (pas du côté opposé), d'où des barres un peu plus courtes.
  const half = W / 2 - 165;
  // Échelle fixe (plafond) : une différence « infinie » ne compresse plus les écarts finis lisibles.
  const scale = (r: number) => (r / RATIO_CAP) * half;

  return (
    <div className="panel">
      <ChartHeader title="Écarts nutriment par nutriment" sel={sel} />
      <NutrientChipsBlock sel={sel} defaultKeys={DEFAULT_ACTIVE} />
      <p className="small" style={{ marginTop: 6 }}>
        La barre s'étire du côté de l'aliment le plus riche ({NORM_LABELS[mode]}) :{' '}
        <span style={{ color: SLOT_COLOR[0] }}>◀ {a.nom}</span> à gauche,{' '}
        <span style={{ color: SLOT_COLOR[1] }}>{b.nom} ▶</span> à droite. Les nutriments proches du centre sont
        similaires ; les extrêmes marquent les grosses différences. Échelle en log₂ du rapport (un cran = ×2). Au bout
        de la barre, côté de l'aliment le plus riche : le rapport (×N), la quantité brute et le % AJR (selon la base) —
        un ×50 sur une trace reste une trace. Cliquez un libellé pour le retirer.
      </p>

      {rows.length === 0 ? (
        <div className="empty">Aucun nutriment actif avec des données pour ces deux aliments.</div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
            <span className="small" style={{ color: SLOT_COLOR[0], fontWeight: 600 }}>◀ plus riche en {a.nom}</span>
            <span className="small" style={{ color: SLOT_COLOR[1], fontWeight: 600 }}>plus riche en {b.nom} ▶</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            <line x1={mid} x2={mid} y1={8} y2={H - 8} stroke={C.border} strokeWidth={1} />
            {rows.map((r, i) => {
              const y = 8 + i * rowH + rowH / 2;
              const len = Math.abs(scale(r.clamped));
              const toA = r.clamped >= 0; // A plus riche → barre à gauche
              const color = toA ? SLOT_COLOR[0] : SLOT_COLOR[1];
              const unit = NUT_UNIT.get(r.k);
              const mult = r.onlyOne ? 'seul' : `×${fmt(Math.pow(2, Math.abs(r.ratio)), 1)}`;
              const valueLabel = `${fmt(r.rich, r.rich < 10 ? 1 : 0)} ${unit}${r.pct != null ? ` · ${fmt(r.pct)} % AJR` : ''}`;
              // ×N + quantité brute + % AJR, ensemble, du côté de l'aliment le plus riche.
              const tipLabel = `${mult} · ${valueLabel}`;
              return (
                <g key={r.k}>
                  <rect
                    x={toA ? mid - len : mid}
                    y={y - 6}
                    width={len}
                    height={12}
                    fill={color}
                    opacity={r.onlyOne ? 0.55 : 0.85}
                    rx={2}
                    data-tip={`${NUT_LABEL.get(r.k)} — ${a.nom} : ${fmt(r.va, r.va < 10 ? 2 : 0)} ${unit} · ${b.nom} : ${fmt(r.vb, r.vb < 10 ? 2 : 0)} ${unit}`}
                  />
                  {/* Libellé du nutriment : côté opposé à la barre, cliquable pour le retirer. */}
                  <text
                    x={mid + (toA ? 8 : -8)}
                    y={y}
                    fontSize={11}
                    fill={C.text}
                    textAnchor={toA ? 'start' : 'end'}
                    dominantBaseline="middle"
                    style={{ cursor: 'pointer' }}
                    onClick={() => sel.toggle(r.k)}
                    data-tip="Retirer ce nutriment"
                  >
                    {NUT_LABEL.get(r.k)}
                  </text>
                  {/* ×N + quantité brute + % AJR, au bout de la barre, côté aliment le plus riche. */}
                  <text
                    x={toA ? mid - len - 6 : mid + len + 6}
                    y={y}
                    fontSize={10}
                    fill={C.muted}
                    textAnchor={toA ? 'end' : 'start'}
                    dominantBaseline="middle"
                  >
                    {tipLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radar : profils superposés (chaque axe normalisé au max des deux aliments)
// ---------------------------------------------------------------------------

function RadarCompare({ a, b, mode }: { a: Food; b: Food; mode: NormMode }) {
  const sel = useNutrientSelection(DEFAULT_ACTIVE);
  const keys = sel.activeKeys;

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
      <ChartHeader title="Radar des profils" sel={sel} />
      <NutrientChipsBlock sel={sel} defaultKeys={DEFAULT_ACTIVE} />
      <p className="small" style={{ marginTop: 6 }}>
        Chaque axe est mis à l'échelle sur le plus riche des deux ({NORM_LABELS[mode]}) : la forme montre d'un coup
        d'œil où chacun domine. <span style={{ color: SLOT_COLOR[0] }}>■ {a.nom}</span>{' '}
        <span style={{ color: SLOT_COLOR[1] }}>■ {b.nom}</span>. Cliquez un libellé d'axe pour le retirer.
      </p>

      {axes.length < 3 ? (
        <div className="empty">Activez au moins 3 nutriments avec des données pour tracer le radar.</div>
      ) : (
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
                <text
                  x={lx}
                  y={ly}
                  fontSize={10}
                  fill={C.muted}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ cursor: 'pointer' }}
                  onClick={() => sel.toggle(ax.k)}
                  data-tip="Retirer ce nutriment"
                >
                  {NUT_LABEL.get(ax.k)}
                </text>
              </g>
            );
          })}
          <polygon points={polygon((ax) => ax.va)} fill={SLOT_COLOR[0]} fillOpacity={0.25} stroke={SLOT_COLOR[0]} strokeWidth={2} />
          <polygon points={polygon((ax) => ax.vb)} fill={SLOT_COLOR[1]} fillOpacity={0.2} stroke={SLOT_COLOR[1]} strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voisins (substituts) & complémentaires
// ---------------------------------------------------------------------------

/**
 * Données de voisinage sur les nutriments actifs (base normalisée `mode`) :
 *  - `rel` : richesse relative 0→1 de chaque aliment (valeur ÷ 95ᵉ percentile de la
 *    banque, plafonnée à 1). Le percentile plutôt que le max évite qu'un seul aliment
 *    extrême (souvent un complément pur) fixe l'échelle et écrase tous les autres ;
 *  - `weights` : poids d'importance par nutriment ;
 *  - `wnorm` : norme pondérée par aliment (dénominateur du cosinus, précalculé).
 */
function useNeighborData(foods: Food[], keys: NutrientKey[], mode: NormMode, weightFor: (k: NutrientKey) => number) {
  return useMemo(() => {
    const m = keys.length;
    const raw: number[][] = foods.map((f) => keys.map((k) => normalizedValue(f, k, mode)));
    // Échelle robuste : 95ᵉ percentile de la colonne (repli sur le max si p95 = 0).
    const scale = new Array(m).fill(0);
    for (let j = 0; j < m; j++) {
      const col = raw.map((r) => r[j]).sort((a, b) => a - b);
      const p95 = quantile(col, 0.95) ?? 0;
      scale[j] = p95 > 0 ? p95 : col[col.length - 1] ?? 0;
    }
    const weights = keys.map((k) => Math.max(0, weightFor(k)));
    // Richesse relative plafonnée à 1 : au-delà du p95, tous « au plafond » (pas de dominance de l'outlier).
    const rel: number[][] = raw.map((r) => r.map((v, j) => (scale[j] > 0 ? Math.min(1, v / scale[j]) : 0)));
    const wnorm = rel.map((rr) => Math.sqrt(rr.reduce((a, v, j) => a + weights[j] * v * v, 0)));
    return { raw, scale, weights, rel, wnorm, index: new Map(foods.map((f, i) => [f.id, i])) };
  }, [foods, keys, mode, weightFor]);
}

function NeighborsPanel({
  foods,
  a,
  b,
  mode,
  weightFor,
  onPick,
}: {
  foods: Food[];
  a: Food | null;
  b: Food | null;
  mode: NormMode;
  weightFor: (k: NutrientKey) => number;
  onPick: (slot: 0 | 1, id: string) => void;
}) {
  const sel = useNutrientSelection(COMPARABLE_KEYS);
  const activeKeys = sel.activeKeys;
  const data = useNeighborData(foods, activeKeys, mode, weightFor);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const neighborsOf = (food: Food, otherSlot: 0 | 1) => {
    const i = data.index.get(food.id);
    if (i == null || activeKeys.length === 0) return null;
    const relI = data.rel[i];
    const normI = data.wnorm[i];
    // Vecteur de manques de l'aliment de référence : 1 = à zéro, 0 = déjà au plafond (p95).
    const gap = relI.map((v) => 1 - v);
    const gapNorm = Math.sqrt(gap.reduce((a, v, j) => a + data.weights[j] * v * v, 0));

    const scored = foods.map((f, k) => {
      if (k === i) return null;
      const relK = data.rel[k];
      let dot = 0; // similarité : richesse commune
      let cdot = 0; // complément : richesse du candidat alignée sur les manques de la référence
      for (let j = 0; j < relI.length; j++) {
        dot += data.weights[j] * relI[j] * relK[j];
        cdot += data.weights[j] * gap[j] * relK[j];
      }
      // Deux cosinus pondérés ∈ [0,1], indépendants de la concentration globale :
      //  - sim   = angle entre les deux profils de richesse (même « forme » → 1) ;
      //  - compl = angle entre les MANQUES de la référence et la richesse du candidat
      //            (comble précisément les carences → 1 ; un aliment « riche partout »
      //            ne gagne plus par sa seule densité).
      const sim = normI > 1e-12 && data.wnorm[k] > 1e-12 ? dot / (normI * data.wnorm[k]) : 0;
      const compl = gapNorm > 1e-12 && data.wnorm[k] > 1e-12 ? cdot / (gapNorm * data.wnorm[k]) : 0;
      return { f, sim, compl };
    }).filter((x): x is { f: Food; sim: number; compl: number } => x !== null);

    // Nutriments qui portent le plus le score d'un candidat (pour le détail au clic).
    const partsOf = (f: Food, kind: 'sub' | 'compl') => {
      const kk = data.index.get(f.id)!;
      const relK = data.rel[kk];
      return activeKeys
        .map((key, j) => ({
          key,
          c: kind === 'sub' ? data.weights[j] * relI[j] * relK[j] : data.weights[j] * gap[j] * relK[j],
          val: data.raw[kk][j],
        }))
        .filter((p) => p.c > 1e-9)
        .sort((a, b) => b.c - a.c)
        .slice(0, 4);
    };

    const substitutes = [...scored].sort((x, y) => y.sim - x.sim).slice(0, 5).map((s) => ({ ...s, parts: partsOf(s.f, 'sub') }));
    const complements = [...scored].sort((x, y) => y.compl - x.compl).slice(0, 5).map((s) => ({ ...s, parts: partsOf(s.f, 'compl') }));
    return { substitutes, complements, otherSlot };
  };

  const blocks = [a ? { food: a, slot: 0 as const } : null, b ? { food: b, slot: 1 as const } : null].filter(
    (x): x is { food: Food; slot: 0 | 1 } => x !== null,
  );

  if (blocks.length === 0) return null;

  return (
    <div className="panel">
      <ChartHeader title="Substituts & compléments" sel={sel} />
      <NutrientChipsBlock sel={sel} defaultKeys={DEFAULT_ACTIVE} />
      <p className="small" style={{ marginTop: 6 }}>
        <strong>Substituts</strong> = profil le plus proche en <em>forme</em> (similarité cosinus en %, indépendante de
        la concentration : par quoi remplacer sans changer l'équilibre nutritionnel).{' '}
        <strong>Compléments</strong> = comblent le mieux ses <em>manques</em> (cosinus entre carences et richesse, en
        % ; un aliment « riche partout » ne gagne plus par sa seule densité). Cliquez une ligne pour la charger dans
        l'emplacement opposé, ou <span className="mono">ⓘ</span> pour voir les nutriments qui portent le score.
      </p>
      {activeKeys.length === 0 ? (
        <div className="empty">Activez au moins un nutriment.</div>
      ) : (
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
                {res.substitutes.map((s) => {
                  const key = `${slot}-sub-${s.f.id}`;
                  return (
                    <SuggestionRow
                      key={key}
                      s={s}
                      kind="sub"
                      score={s.sim}
                      color={C.accent}
                      otherSlot={res.otherSlot}
                      onPick={onPick}
                      open={detailKey === key}
                      onToggle={() => setDetailKey((d) => (d === key ? null : key))}
                    />
                  );
                })}
                <div className="small" style={{ color: C.muted, margin: '8px 0 2px' }}>Compléments</div>
                {res.complements.map((s) => {
                  const key = `${slot}-compl-${s.f.id}`;
                  return (
                    <SuggestionRow
                      key={key}
                      s={s}
                      kind="compl"
                      score={s.compl}
                      color={C.accent2}
                      otherSlot={res.otherSlot}
                      onPick={onPick}
                      open={detailKey === key}
                      onToggle={() => setDetailKey((d) => (d === key ? null : key))}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Une suggestion (substitut ou complément) : ligne cliquable + ⓘ dépliant le détail du score. */
function SuggestionRow({
  s,
  kind,
  score,
  color,
  otherSlot,
  onPick,
  open,
  onToggle,
}: {
  s: { f: Food; parts: { key: NutrientKey; val: number }[] };
  kind: 'sub' | 'compl';
  score: number;
  color: string;
  otherSlot: 0 | 1;
  onPick: (slot: 0 | 1, id: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div className="compare-neighbor-row">
        <button
          className="compare-neighbor"
          onClick={() => onPick(otherSlot, s.f.id)}
          data-tip={`${kind === 'sub' ? 'Similarité de profil' : 'Comble les manques'} ${fmt(score * 100)} % · charger dans l'emplacement ${otherSlot === 0 ? 'A' : 'B'}`}
        >
          <span>{s.f.nom}</span>
          <span className="mono small" style={{ color }}>{fmt(score * 100)} %</span>
        </button>
        <button
          className={`ghost small compare-detail-toggle ${open ? 'chip-active' : ''}`}
          onClick={onToggle}
          data-tip="Détail du score"
          aria-label="Détail du score"
        >
          ⓘ
        </button>
      </div>
      {open && (
        <div className="compare-detail small">
          <span style={{ color: C.muted }}>{kind === 'sub' ? 'Profil porté surtout par : ' : 'Comble surtout : '}</span>
          {s.parts.length === 0
            ? '—'
            : s.parts.map((p) => {
                const rda = NUT_RDA.get(p.key) ?? 0;
                const pct = rda > 0 ? (p.val / rda) * 100 : null;
                return (
                  <span key={p.key} className="compare-detail-chip">
                    {NUT_LABEL.get(p.key)}{' '}
                    <span style={{ color: C.muted }}>
                      {fmt(p.val, p.val < 10 ? 1 : 0)} {NUT_UNIT.get(p.key)}{pct != null ? ` · ${fmt(pct)} %` : ''}
                    </span>
                  </span>
                );
              })}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Biplot ACP : carte de toute la banque + flèches nutriments (zoom / pan)
// ---------------------------------------------------------------------------

/** Transform de zoom/pan en pixels (façon d3.zoom), appliqué en rééchelonnant les axes. */
type ZoomTransform = { k: number; x: number; y: number };
const ZOOM_IDENTITY: ZoomTransform = { k: 1, x: 0, y: 0 };
const ZOOM_MIN = 0.2; // < 1 pour pouvoir dézoomer au-delà de la vue initiale
const ZOOM_MAX = 24;

type EmbedMethod = 'pca' | 'tsne' | 'mds';
const METHOD_LABEL: Record<EmbedMethod, string> = { pca: 'ACP', tsne: 't-SNE', mds: 'MDS' };

function PcaBiplot({
  foods,
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
  mode: NormMode;
  weightFor: (k: NutrientKey) => number;
  selected: [Food | null, Food | null];
  showArrows: boolean;
  setShowArrows: (v: boolean) => void;
  hideCats: Set<FoodCategory>;
  setHideCats: (s: Set<FoodCategory>) => void;
  onPick: (slot: 0 | 1, id: string) => void;
}) {
  const sel = useNutrientSelection(COMPARABLE_KEYS);
  const activeKeys = sel.activeKeys;
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ id: string; px: number; py: number } | null>(null);
  // Menu de choix ouvert au clic sur un point : charger l'aliment en A ou en B.
  const [menu, setMenu] = useState<{ id: string; px: number; py: number } | null>(null);
  const [query, setQuery] = useState('');
  // Méthode de projection 2D de la carte.
  const [method, setMethod] = useState<'pca' | 'tsne' | 'mds'>('pca');

  const W = 680;
  const H = 520;
  const m = { top: 20, right: 20, bottom: 20, left: 20 };

  // Zoom / pan (molette + glisser + pincement), même principe que le nuage : on
  // rééchelonne les axes plutôt que de transformer le SVG (n'écrase pas les textes).
  const [zoomX, setZoomX] = useState<ZoomTransform>(ZOOM_IDENTITY);
  const [zoomY, setZoomY] = useState<ZoomTransform>(ZOOM_IDENTITY);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number } | null>(null);

  const activeKey = activeKeys.join(',');
  // Un changement d'axes / base rend l'ancien cadrage obsolète.
  useEffect(() => {
    setZoomX(ZOOM_IDENTITY);
    setZoomY(ZOOM_IDENTITY);
    setMenu(null);
  }, [activeKey, mode, method]);

  function zoomAt(factor: number, px: number, py: number) {
    setZoomX((z) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z.k * factor));
      const d = (px - z.x) / z.k;
      return { k, x: px - d * k, y: 0 };
    });
    setZoomY((z) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z.k * factor));
      const d = (py - z.y) / z.k;
      return { k, x: 0, y: py - d * k };
    });
  }

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      const py = ((e.clientY - rect.top) / rect.height) * H;
      if (e.ctrlKey) {
        zoomAt(Math.exp(-e.deltaY * 0.01), px, py);
      } else {
        setZoomX((z) => ({ ...z, x: z.x - e.deltaX }));
        setZoomY((z) => ({ ...z, y: z.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [W, H]);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    // Pas de setPointerCapture ici : il redirigerait le « click » vers le SVG et
    // empêcherait le clic sur un point (menu A/B). Le pan reste géré tant que le
    // pointeur survole la carte, ce qui suffit largement.
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
    } else {
      dragRef.current = null;
      const pts = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    }
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size >= 2 && svgRef.current) {
      const [p0, p1] = [...pointersRef.current.values()];
      const rect = svgRef.current.getBoundingClientRect();
      const dist = Math.hypot(p0.x - p1.x, p0.y - p1.y);
      const cx = ((p0.x + p1.x) / 2 - rect.left) / rect.width * W;
      const cy = ((p0.y + p1.y) / 2 - rect.top) / rect.height * H;
      if (pinchRef.current && pinchRef.current.dist > 0) zoomAt(dist / pinchRef.current.dist, cx, cy);
      pinchRef.current = { dist };
      return;
    }

    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.x) / rect.width) * W;
    const dy = ((e.clientY - dragRef.current.y) / rect.height) * H;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) setMenu(null); // un déplacement ferme le menu
    dragRef.current = { x: e.clientX, y: e.clientY };
    setZoomX((z) => ({ ...z, x: z.x + dx }));
    setZoomY((z) => ({ ...z, y: z.y + dy }));
  }
  function endDrag(e: React.PointerEvent<SVGSVGElement>) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 1) {
      const [remaining] = pointersRef.current.values();
      dragRef.current = { x: remaining.x, y: remaining.y };
    } else {
      dragRef.current = null;
      setDragging(false);
    }
  }
  const zoomed = zoomX.k > 1.001 || zoomY.k > 1.001 || Math.abs(zoomX.x) > 0.5 || Math.abs(zoomY.y) > 0.5;

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
    const ids = bank.map((f) => f.id);
    const matrix = bank.map((f) => activeKeys.map((k) => normalizedValue(f, k, mode)));
    const weights = activeKeys.map((k) => weightFor(k));
    if (method === 'tsne') return { kind: 'tsne' as const, ...tsne({ ids, matrix, weights }) };
    if (method === 'mds') return { kind: 'mds' as const, ...mds({ ids, matrix, weights }) };
    return { kind: 'pca' as const, ...pca2({ ids, keys: activeKeys, matrix, weights }) };
  }, [bank, activeKey, mode, weightFor, method]);
  const isPca = result?.kind === 'pca';

  const foodById = useMemo(() => new Map(bank.map((f) => [f.id, f])), [bank]);

  // Qualité de représentation par aliment (0→1) : cos² en ACP, fidélité des distances
  // en MDS ; absente en t-SNE. Sert à l'opacité (pâle = mal représenté) et au survol.
  const qualById = useMemo(() => {
    const map = new Map<string, number>();
    if (result?.kind === 'pca') for (const s of result.scores) map.set(s.id, s.cos2);
    else if (result?.kind === 'mds') for (const s of result.scores) if (s.rep != null) map.set(s.id, s.rep);
    return map;
  }, [result]);

  const q = normalize(query);
  const matchIds = useMemo(() => {
    if (!q) return new Set<string>();
    return new Set(
      bank.filter((f) => normalize(f.nom).includes(q) || f.aliases.some((a) => normalize(a).includes(q))).map((f) => f.id),
    );
  }, [bank, q]);

  const onMove = (e: React.MouseEvent, id: string) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setHover({ id, px: ((e.clientX - rect.left) / rect.width) * 100, py: ((e.clientY - rect.top) / rect.height) * 100 });
  };

  const onPointClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setHover(null);
    setMenu({ id, px: ((e.clientX - rect.left) / rect.width) * 100, py: ((e.clientY - rect.top) / rect.height) * 100 });
  };

  const toggleCat = (key: FoodCategory) => {
    const n = new Set(hideCats);
    n.has(key) ? n.delete(key) : n.add(key);
    setHideCats(n);
  };

  return (
    <div className="panel">
      <ChartHeader title={`Carte de la banque — ${METHOD_LABEL[method]}`} sel={sel} />
      <NutrientChipsBlock sel={sel} defaultKeys={DEFAULT_ACTIVE} />

      {!result ? (
        <div className="empty" style={{ marginTop: 8 }}>Activez au moins 2 nutriments pour tracer la carte.</div>
      ) : (
        (() => {
          const selectedIds = new Set(selected.filter((f): f is Food => !!f).map((f) => f.id));
          // Vue « type commun » des scores (les variantes ACP/embed diffèrent sur les champs de qualité).
          const pts = result.scores as { id: string; x: number; y: number }[];

          const [minX, maxX] = extent(pts, (s) => s.x) as [number, number];
          const [minY, maxY] = extent(pts, (s) => s.y) as [number, number];
          const xs = scaleLinear().domain([minX, maxX]).nice().range([m.left, W - m.right]);
          const ys = scaleLinear().domain([minY, maxY]).nice().range([H - m.bottom, m.top]);
          const vxs = rescaleAxis(xs, { k: zoomX.k, t: zoomX.x });
          const vys = rescaleAxis(ys, { k: zoomY.k, t: zoomY.y });

          const visibleScores = pts.filter((s) => {
            const f = foodById.get(s.id);
            return f && (!hideCats.has(f.categorie) || selectedIds.has(f.id));
          });

          // Flèches (ACP seulement) : mises à l'échelle du nuage (loadings dans un autre repère).
          const pcaRes = result.kind === 'pca' ? result : null;
          const scoreR = Math.max(Math.abs(minX), Math.abs(maxX), Math.abs(minY), Math.abs(maxY)) || 1;
          const loadR = pcaRes ? Math.max(1, ...pcaRes.loadings.map((l) => Math.hypot(l.x, l.y))) : 1;
          const arrowScale = (scoreR / loadR) * 0.85;
          const ax = (v: number) => vxs(v * arrowScale);
          const ay = (v: number) => vys(v * arrowScale);
          const originX = vxs(0);
          const originY = vys(0);

          const hoverFood = hover ? foodById.get(hover.id) : null;

          return (
            <>
              <div className="row" style={{ gap: 6, margin: '8px 0', flexWrap: 'wrap', alignItems: 'center' }}>
                <span className="small" style={{ color: C.muted }}>Projection :</span>
                {(['pca', 'tsne', 'mds'] as EmbedMethod[]).map((mth) => (
                  <button key={mth} className={`ghost small ${method === mth ? 'chip-active' : ''}`} onClick={() => setMethod(mth)}>
                    {METHOD_LABEL[mth]}
                  </button>
                ))}
                {isPca && (
                  <button className={`ghost small ${showArrows ? 'chip-active' : ''}`} onClick={() => setShowArrows(!showArrows)}>
                    Flèches nutriments
                  </button>
                )}
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Surligner un aliment…"
                  style={{ flex: '1 1 160px', minWidth: 140 }}
                />
                <span style={{ flex: 1 }} />
                <button className="ghost small" data-tip="Zoomer" onClick={() => zoomAt(1.6, (m.left + W - m.right) / 2, (m.top + H - m.bottom) / 2)}>
                  🔍＋
                </button>
                <button className="ghost small" data-tip="Dézoomer" onClick={() => zoomAt(1 / 1.6, (m.left + W - m.right) / 2, (m.top + H - m.bottom) / 2)}>
                  🔍−
                </button>
                <button className="ghost small" disabled={!zoomed} onClick={() => { setZoomX(ZOOM_IDENTITY); setZoomY(ZOOM_IDENTITY); }}>
                  Réinitialiser le zoom
                </button>
                {zoomed && <span className="small mono">×{fmt(Math.max(zoomX.k, zoomY.k), 1)}</span>}
              </div>
              <p className="small" style={{ marginTop: -4 }}>
                {pcaRes ? (
                  <>
                    Chaque point = un aliment sur les 2 axes de plus grande variance ({NORM_LABELS[mode]}) ; les flèches
                    montrent quels nutriments les tirent. Variance expliquée : {fmt(pcaRes.explained[0] * 100)} % +{' '}
                    {fmt(pcaRes.explained[1] * 100)} %
                    {pcaRes.explained[0] + pcaRes.explained[1] < 0.5 && (
                      <span style={{ color: C.warn }}> · carte approximative</span>
                    )}
                    . Opacité = <strong>cos²</strong> (un point pâle est mal représenté en 2D — à ne pas
                    sur-interpréter).{' '}
                  </>
                ) : method === 'tsne' ? (
                  <>
                    <strong>t-SNE</strong> : regroupe les aliments par voisinage — les <strong>grappes</strong> = familles
                    de profils. Les distances <em>entre</em> grappes et leurs tailles ne sont pas significatives (pas
                    d'axes ni de flèches, pas de qualité par point ; {NORM_LABELS[mode]}).{' '}
                  </>
                ) : (
                  <>
                    <strong>MDS</strong> : place les aliments pour respecter au mieux leurs <strong>distances</strong> de
                    profil (proche de l'ACP, sans flèches ; {NORM_LABELS[mode]}). Opacité ={' '}
                    <strong>fidélité des distances</strong> (pâle = distances mal préservées autour du point).{' '}
                  </>
                )}
                Ctrl + molette (ou pincer) pour zoomer, glisser pour déplacer. Cliquez un point pour le mettre en A ou en B.
              </p>
              <div style={{ position: 'relative' }}>
                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${W} ${H}`}
                  style={{ width: '100%', display: 'block', touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setMenu(null)}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <defs>
                    <clipPath id="pca-clip">
                      <rect x={m.left} y={m.top} width={W - m.left - m.right} height={H - m.top - m.bottom} />
                    </clipPath>
                  </defs>
                  <line x1={originX} x2={originX} y1={m.top} y2={H - m.bottom} stroke={C.border} strokeWidth={1} opacity={0.6} />
                  <line x1={m.left} x2={W - m.right} y1={originY} y2={originY} stroke={C.border} strokeWidth={1} opacity={0.6} />

                  <g clipPath="url(#pca-clip)">
                    {pcaRes && showArrows &&
                      pcaRes.loadings.map((l) => {
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
                      const sa = pts.find((s) => s.id === selected[0]!.id);
                      const sb = pts.find((s) => s.id === selected[1]!.id);
                      if (!sa || !sb) return null;
                      return <line x1={vxs(sa.x)} y1={vys(sa.y)} x2={vxs(sb.x)} y2={vys(sb.y)} stroke={C.muted} strokeWidth={1} strokeDasharray="3 3" />;
                    })()}

                    {visibleScores.map((s) => {
                      const f = foodById.get(s.id)!;
                      const isSel = selectedIds.has(s.id);
                      const slot = selected[0]?.id === s.id ? 0 : selected[1]?.id === s.id ? 1 : null;
                      const isMatch = matchIds.has(s.id);
                      const isMenu = menu?.id === s.id;
                      const qy = qualById.get(s.id);
                      // Opacité = qualité de représentation (pâle = mal représenté en 2D) ; une
                      // recherche active prime (estompe fort les non-correspondants).
                      const fade = qy == null ? 0.85 : 0.18 + 0.82 * qy;
                      const op = q ? (isMatch || isSel ? 1 : 0.15) : isSel ? 1 : fade;
                      const r = isSel ? 7 : isMatch || isMenu ? 6 : 5;
                      // Zone de tap invisible plus large que le point : vise au doigt sur mobile.
                      const hitR = Math.max(r + 9, 15);
                      const cxp = vxs(s.x);
                      const cyp = vys(s.y);
                      return (
                        <g key={s.id}>
                          <circle
                            cx={cxp}
                            cy={cyp}
                            r={r}
                            fill={slot != null ? SLOT_COLOR[slot] : COLOR_BY_CAT.get(f.categorie) ?? C.muted}
                            stroke={isSel ? C.text : isMatch || isMenu ? C.accent2 : 'none'}
                            strokeWidth={isSel ? 2 : isMatch || isMenu ? 2 : 0}
                            opacity={op}
                            pointerEvents="none"
                          />
                          <circle
                            cx={cxp}
                            cy={cyp}
                            r={hitR}
                            fill="transparent"
                            style={{ cursor: 'pointer' }}
                            onMouseMove={(e) => onMove(e, s.id)}
                            onClick={(e) => onPointClick(e, s.id)}
                          />
                        </g>
                      );
                    })}
                  </g>
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
                    {(() => {
                      const qy = qualById.get(hover.id);
                      if (qy == null) return null;
                      const low = qy < 0.4;
                      return (
                        <div className="small" style={{ color: low ? C.warn : C.muted, marginTop: 2 }}>
                          {method === 'pca' ? 'cos²' : 'fidélité'} {fmt(qy * 100)} %{low ? ' · mal représenté en 2D' : ''}
                        </div>
                      );
                    })()}
                  </div>
                )}
                {menu && (() => {
                  const mf = foodById.get(menu.id);
                  if (!mf) return null;
                  const inA = selected[0]?.id === menu.id;
                  const inB = selected[1]?.id === menu.id;
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${menu.px}%`,
                        top: `${menu.py}%`,
                        transform: 'translate(-50%, -115%)',
                        background: C.panel2,
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: 8,
                        zIndex: 6,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <div className="small" style={{ color: C.text, marginBottom: 6, textAlign: 'center', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {mf.nom}
                      </div>
                      <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                        <button
                          className="ghost small"
                          style={{ borderColor: SLOT_COLOR[0], color: SLOT_COLOR[0], fontWeight: 600 }}
                          onClick={() => { onPick(0, menu.id); setMenu(null); }}
                        >
                          {inA ? '✓ en A' : '→ mettre en A'}
                        </button>
                        <button
                          className="ghost small"
                          style={{ borderColor: SLOT_COLOR[1], color: SLOT_COLOR[1], fontWeight: 600 }}
                          onClick={() => { onPick(1, menu.id); setMenu(null); }}
                        >
                          {inB ? '✓ en B' : '→ mettre en B'}
                        </button>
                      </div>
                    </div>
                  );
                })()}
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
            </>
          );
        })()
      )}
    </div>
  );
}
