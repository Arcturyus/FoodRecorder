import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog, scaleSqrt } from 'd3-scale';
import { extent, max as d3max, mean as d3mean, quantile } from 'd3-array';
import { RDA } from '../nutrition/rda';
import type { Food, FoodCategory, NutrientKey } from '../nutrition/types';
import { fmt } from './format';

/**
 * « Explorer visuel » : atelier de visualisation D3 de la banque d'aliments, pour
 * lire la table sous plusieurs angles (données pour 100 g). Trois vues :
 *  - Nuage de points / bulles : deux (ou trois) nutriments croisés, frontière de
 *    Pareto pour repérer p. ex. « max protéines / min kcal » ;
 *  - Matrice de corrélation : liens statistiques entre tous les nutriments ;
 *  - Coordonnées parallèles : profil multi-nutriments de chaque aliment.
 * On reste volontairement en D3 pur (SVG maison, d3-scale/array/shape).
 */

/** Palette alignée sur les variables CSS du thème (dark). */
const C = {
  accent: '#5b8cff',
  accent2: '#3ecf8e',
  warn: '#f5a623',
  danger: '#ef5d5d',
  muted: '#9aa2b1',
  border: '#2a2f3a',
  text: '#e6e8ec',
  panel: '#181b22',
  panel2: '#1f232c',
};

/** Couleur par catégorie d'aliment (encodage constant sur toutes les vues). */
const CATS: { key: FoodCategory; label: string; color: string }[] = [
  { key: 'fruit', label: 'Fruits', color: '#ef6f6f' },
  { key: 'legume', label: 'Légumes', color: '#3ecf8e' },
  { key: 'feculent', label: 'Féculents', color: '#f5a623' },
  { key: 'viande', label: 'Viandes', color: '#c8603f' },
  { key: 'poisson', label: 'Poissons', color: '#5b8cff' },
  { key: 'oeuf-laitier', label: 'Œufs & laitages', color: '#e3c65b' },
  { key: 'sucre-snack', label: 'Sucré / snacks', color: '#d16ba5' },
  { key: 'matiere-grasse', label: 'M. grasses', color: '#8ac926' },
  { key: 'boisson', label: 'Boissons', color: '#4dc9d0' },
  { key: 'plat', label: 'Plats', color: '#a58bff' },
  { key: 'autre', label: 'Autres', color: '#9aa2b1' },
];
const COLOR_BY_CAT = new Map(CATS.map((c) => [c.key, c.color]));

/**
 * Aliments explorables : on retire les compléments (produits purs très concentrés,
 * ex. comprimé de vitamine C) qui écraseraient toutes les échelles des graphiques.
 */
/**
 * Aliments explorables fournis par le parent (banque avec overrides + perso),
 * partagés aux sous-vues via un contexte pour éviter de tout re-câbler en props.
 * Les compléments sont retirés en amont (voir provider dans FoodExplorer).
 */
const ExplorableCtx = createContext<Food[]>([]);
const useExplorable = () => useContext(ExplorableCtx);

/** Nutriments sélectionnables (pilotés par la table RDA pour label + unité). */
const NUT = RDA.map((r) => ({ key: r.key, label: r.label, unit: r.unit }));
const NUT_LABEL = new Map(NUT.map((n) => [n.key, n.label]));
const NUT_UNIT = new Map(NUT.map((n) => [n.key, n.unit]));

const val = (f: Food, k: NutrientKey) => f.n[k];
const axisTitle = (k: NutrientKey) => `${NUT_LABEL.get(k)} (${NUT_UNIT.get(k)}) /100 g`;

type View = 'nuage' | 'correlation' | 'paralleles';

export function FoodExplorer({ foods }: { foods: Food[] }) {
  const [view, setView] = useState<View>('nuage');
  const explorable = useMemo(() => foods.filter((f) => f.categorie !== 'supplement'), [foods]);

  return (
    <ExplorableCtx.Provider value={explorable}>
      <div className="panel">
        <p className="small" style={{ marginTop: 0, marginBottom: 8 }}>
          {explorable.length} aliments · valeurs pour 100 g. Croisez les nutriments, mesurez leurs corrélations,
          comparez les profils. Couleur = catégorie sur toutes les vues.
        </p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`ghost small ${view === 'nuage' ? 'chip-active' : ''}`} onClick={() => setView('nuage')}>
            Nuage de points / bulles
          </button>
          <button
            className={`ghost small ${view === 'correlation' ? 'chip-active' : ''}`}
            onClick={() => setView('correlation')}
          >
            Matrice de corrélation
          </button>
          <button
            className={`ghost small ${view === 'paralleles' ? 'chip-active' : ''}`}
            onClick={() => setView('paralleles')}
          >
            Coordonnées parallèles
          </button>
        </div>
      </div>

      {view === 'nuage' && <ScatterView />}
      {view === 'correlation' && <CorrelationView />}
      {view === 'paralleles' && <ParallelView />}

      <CategoryLegend />
    </ExplorableCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Légende catégories (partagée)
// ---------------------------------------------------------------------------

function CategoryLegend() {
  return (
    <div className="panel">
      <div className="small" style={{ marginBottom: 8 }}>Catégories</div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        {CATS.map((c) => (
          <span key={c.key} className="row" style={{ gap: 5, alignItems: 'center' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, display: 'inline-block' }} />
            <span className="small" style={{ color: C.text }}>{c.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip partagé (position en % du conteneur → responsive)
// ---------------------------------------------------------------------------

function Tooltip({ px, py, children }: { px: number; py: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${px}%`,
        top: `${py}%`,
        transform: 'translate(-50%, -120%)',
        background: C.panel2,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '6px 9px',
        fontSize: 12,
        color: C.text,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        zIndex: 5,
        boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
      }}
    >
      {children}
    </div>
  );
}

function toViewBox(e: React.MouseEvent, svg: SVGSVGElement, W: number, H: number) {
  const rect = svg.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * W,
    y: ((e.clientY - rect.top) / rect.height) * H,
    px: ((e.clientX - rect.left) / rect.width) * 100,
    py: ((e.clientY - rect.top) / rect.height) * 100,
  };
}

function NutSelect({ label, value, onChange, allowNone }: {
  label: string;
  value: NutrientKey | 'none';
  onChange: (k: NutrientKey | 'none') => void;
  allowNone?: boolean;
}) {
  return (
    <label className="field" style={{ minWidth: 150 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as NutrientKey | 'none')}>
        {allowNone && <option value="none">— aucun —</option>}
        {NUT.map((n) => (
          <option key={n.key} value={n.key}>
            {n.label} ({n.unit})
          </option>
        ))}
      </select>
    </label>
  );
}

// ===========================================================================
// Vue 1 — Nuage de points / bulles + frontière de Pareto
// ===========================================================================

function ScatterView() {
  const [xk, setXk] = useState<NutrientKey>('kcal');
  const [yk, setYk] = useState<NutrientKey>('proteines');
  const [sizeK, setSizeK] = useState<NutrientKey | 'none'>('none');
  const [logX, setLogX] = useState(false);
  const [logY, setLogY] = useState(false);
  const [pareto, setPareto] = useState(true);
  const [xGoal, setXGoal] = useState<'min' | 'max'>('min');
  const [yGoal, setYGoal] = useState<'min' | 'max'>('max');
  const [hideCats, setHideCats] = useState<Set<FoodCategory>>(new Set());

  const W = 680;
  const H = 460;
  const m = { top: 18, right: 18, bottom: 46, left: 58 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  const explorable = useExplorable();

  const points = useMemo(() => {
    return explorable
      .filter((f) => !hideCats.has(f.categorie))
      .map((f) => ({ f, x: val(f, xk), y: val(f, yk), s: sizeK === 'none' ? 0 : val(f, sizeK) }))
      .filter((p) => (logX ? p.x > 0 : true) && (logY ? p.y > 0 : true) && (p.x > 0 || p.y > 0));
  }, [explorable, xk, yk, sizeK, logX, logY, hideCats]);

  // Frontière de Pareto pour des objectifs quelconques (min/max sur chaque axe).
  // Un point est retenu s'il n'est dominé par aucun autre : « dominé » = un point
  // au moins aussi bon sur les deux axes et strictement meilleur sur au moins un.
  const frontier = useMemo(() => {
    const okX = (a: number, b: number) => (xGoal === 'max' ? a >= b : a <= b);
    const okY = (a: number, b: number) => (yGoal === 'max' ? a >= b : a <= b);
    const gtX = (a: number, b: number) => (xGoal === 'max' ? a > b : a < b);
    const gtY = (a: number, b: number) => (yGoal === 'max' ? a > b : a < b);
    return points
      .filter(
        (p) =>
          !points.some(
            (q) => q !== p && okX(q.x, p.x) && okY(q.y, p.y) && (gtX(q.x, p.x) || gtY(q.y, p.y)),
          ),
      )
      .sort((a, b) => a.x - b.x);
  }, [points, xGoal, yGoal]);
  const frontierSet = useMemo(() => new Set(frontier.map((p) => p.f.id)), [frontier]);

  if (points.length === 0) {
    return <div className="panel"><div className="empty">Aucun aliment à tracer avec ces axes.</div></div>;
  }

  const [x0, x1] = extent(points, (p) => p.x) as [number, number];
  const [y0, y1] = extent(points, (p) => p.y) as [number, number];

  const xs = logX
    ? scaleLog().domain([Math.max(x0, 0.01), x1 || 1]).range([m.left, W - m.right])
    : scaleLinear().domain([0, x1 || 1]).nice().range([m.left, W - m.right]);
  const ys = logY
    ? scaleLog().domain([Math.max(y0, 0.01), y1 || 1]).range([H - m.bottom, m.top])
    : scaleLinear().domain([0, y1 || 1]).nice().range([H - m.bottom, m.top]);

  const sMax = sizeK === 'none' ? 1 : d3max(points, (p) => p.s) || 1;
  const rs = scaleSqrt().domain([0, sMax]).range([3, 22]);
  const radius = (s: number) => (sizeK === 'none' ? 5 : Math.max(3, rs(s)));

  const xTicks = xs.ticks(logX ? 4 : 6);
  const yTicks = ys.ticks(6);

  // Médianes → repères de « quadrant valeur ».
  const medX = quantile(points.map((p) => p.x).sort((a, b) => a - b), 0.5) ?? 0;
  const medY = quantile(points.map((p) => p.y).sort((a, b) => a - b), 0.5) ?? 0;

  const frontierPath = frontier.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xs(p.x)} ${ys(p.y)}`).join(' ');

  return (
    <>
      <div className="panel">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <NutSelect label="Axe X" value={xk} onChange={(k) => setXk(k as NutrientKey)} />
          <NutSelect label="Axe Y" value={yk} onChange={(k) => setYk(k as NutrientKey)} />
          <NutSelect label="Taille des bulles" value={sizeK} onChange={setSizeK} allowNone />
        </div>
        <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
          <button className={`ghost small ${logX ? 'chip-active' : ''}`} onClick={() => setLogX((v) => !v)}>
            X log
          </button>
          <button className={`ghost small ${logY ? 'chip-active' : ''}`} onClick={() => setLogY((v) => !v)}>
            Y log
          </button>
          <button className={`ghost small ${pareto ? 'chip-active' : ''}`} onClick={() => setPareto((v) => !v)}>
            Frontière de Pareto
          </button>
          {pareto && (
            <>
              <button className="ghost small" onClick={() => setXGoal((g) => (g === 'max' ? 'min' : 'max'))}>
                X : {xGoal === 'max' ? 'maximiser ▲' : 'minimiser ▼'}
              </button>
              <button className="ghost small" onClick={() => setYGoal((g) => (g === 'max' ? 'min' : 'max'))}>
                Y : {yGoal === 'max' ? 'maximiser ▲' : 'minimiser ▼'}
              </button>
            </>
          )}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {CATS.map((c) => (
            <button
              key={c.key}
              className="ghost small"
              style={{ opacity: hideCats.has(c.key) ? 0.4 : 1, borderColor: hideCats.has(c.key) ? C.border : c.color }}
              onClick={() =>
                setHideCats((s) => {
                  const n = new Set(s);
                  n.has(c.key) ? n.delete(c.key) : n.add(c.key);
                  return n;
                })
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div style={{ position: 'relative' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: '100%', display: 'block' }}
            onMouseLeave={() => setHover(null)}
          >
            {/* grille */}
            {xTicks.map((t) => (
              <line key={`gx${t}`} x1={xs(t)} x2={xs(t)} y1={m.top} y2={H - m.bottom} stroke={C.border} strokeWidth={1} opacity={0.5} />
            ))}
            {yTicks.map((t) => (
              <line key={`gy${t}`} x1={m.left} x2={W - m.right} y1={ys(t)} y2={ys(t)} stroke={C.border} strokeWidth={1} opacity={0.5} />
            ))}

            {/* médianes */}
            <line x1={xs(medX)} x2={xs(medX)} y1={m.top} y2={H - m.bottom} stroke={C.muted} strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />
            <line x1={m.left} x2={W - m.right} y1={ys(medY)} y2={ys(medY)} stroke={C.muted} strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />

            {/* axes ticks labels */}
            {xTicks.map((t) => (
              <text key={`xt${t}`} x={xs(t)} y={H - m.bottom + 16} fill={C.muted} fontSize={10} textAnchor="middle">
                {fmt(t, t < 1 ? 1 : 0)}
              </text>
            ))}
            {yTicks.map((t) => (
              <text key={`yt${t}`} x={m.left - 8} y={ys(t)} fill={C.muted} fontSize={10} textAnchor="end" dominantBaseline="middle">
                {fmt(t, t < 1 ? 1 : 0)}
              </text>
            ))}
            <text x={(m.left + W - m.right) / 2} y={H - 6} fill={C.text} fontSize={11} textAnchor="middle">
              {axisTitle(xk)}{logX ? ' · log' : ''}
            </text>
            <text transform={`translate(14 ${(m.top + H - m.bottom) / 2}) rotate(-90)`} fill={C.text} fontSize={11} textAnchor="middle">
              {axisTitle(yk)}{logY ? ' · log' : ''}
            </text>

            {/* frontière de Pareto */}
            {pareto && frontier.length > 1 && (
              <path d={frontierPath} fill="none" stroke={C.accent2} strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />
            )}

            {/* points */}
            {points.map((p, i) => {
              const onFront = pareto && frontierSet.has(p.f.id);
              const isHover = hover?.i === i;
              return (
                <circle
                  key={p.f.id}
                  cx={xs(p.x)}
                  cy={ys(p.y)}
                  r={radius(p.s) * (isHover ? 1.35 : 1)}
                  fill={COLOR_BY_CAT.get(p.f.categorie)}
                  fillOpacity={onFront ? 0.95 : 0.72}
                  stroke={onFront ? C.accent2 : isHover ? C.text : 'none'}
                  strokeWidth={onFront ? 2 : isHover ? 1.5 : 0}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={(e) => {
                    if (svgRef.current) {
                      const v = toViewBox(e, svgRef.current, W, H);
                      setHover({ i, px: v.px, py: v.py });
                    }
                  }}
                />
              );
            })}
          </svg>

          {hover && (
            <Tooltip px={hover.px} py={hover.py}>
              <strong>{points[hover.i].f.nom}</strong>
              {frontierSet.has(points[hover.i].f.id) && pareto && (
                <span style={{ color: C.accent2 }}> · Pareto</span>
              )}
              <br />
              {NUT_LABEL.get(xk)} : {fmt(points[hover.i].x, points[hover.i].x < 10 ? 1 : 0)} {NUT_UNIT.get(xk)}
              <br />
              {NUT_LABEL.get(yk)} : {fmt(points[hover.i].y, points[hover.i].y < 10 ? 1 : 0)} {NUT_UNIT.get(yk)}
              {sizeK !== 'none' && (
                <>
                  <br />
                  {NUT_LABEL.get(sizeK)} : {fmt(points[hover.i].s, points[hover.i].s < 10 ? 1 : 0)} {NUT_UNIT.get(sizeK)}
                </>
              )}
            </Tooltip>
          )}
        </div>
        {pareto && (
          <p className="small" style={{ marginBottom: 0 }}>
            Ligne verte = <strong>frontière de Pareto</strong> : les {frontier.length} aliments qu'aucun autre ne
            surpasse à la fois en {NUT_LABEL.get(yk)} ({yGoal === 'max' ? 'plus' : 'moins'}) et en{' '}
            {NUT_LABEL.get(xk)} ({xGoal === 'max' ? 'plus' : 'moins'}). Pointillés gris = médianes.
          </p>
        )}
      </div>
    </>
  );
}

// ===========================================================================
// Vue 2 — Matrice de corrélation (Pearson) entre nutriments
// ===========================================================================

/** Coefficient de corrélation de Pearson entre deux séries alignées. */
function pearson(a: number[], b: number[]): number {
  const ma = d3mean(a) ?? 0;
  const mb = d3mean(b) ?? 0;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den === 0 ? 0 : num / den;
}

/** Couleur divergente rouge (−1) → neutre (0) → bleu (+1). */
function corrColor(r: number): string {
  const neg = [239, 93, 93]; // danger
  const pos = [91, 140, 255]; // accent
  const neutral = [31, 35, 44]; // panel2
  const t = Math.abs(r);
  const target = r >= 0 ? pos : neg;
  const mix = neutral.map((c, i) => Math.round(c + (target[i] - c) * t));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

function CorrelationView() {
  const [onlyMacros, setOnlyMacros] = useState(false);

  const explorable = useExplorable();
  const MACRO_KEYS: NutrientKey[] = ['kcal', 'proteines', 'glucides', 'lipides', 'fibres', 'agSatures', 'agMonoInsatures', 'agPolyInsatures', 'omega3', 'omega6', 'omega9'];
  const keys = onlyMacros ? MACRO_KEYS : (NUT.map((n) => n.key) as NutrientKey[]);

  const cols = useMemo(() => keys.map((k) => explorable.map((f) => val(f, k))), [explorable, keys.join(',')]);
  const matrix = useMemo(
    () => keys.map((_, i) => keys.map((_, j) => (i === j ? 1 : pearson(cols[i], cols[j])))),
    [cols],
  );

  const n = keys.length;
  const cell = onlyMacros ? 42 : 24;
  const labelW = 96;
  const labelTop = 96;
  const W = labelW + n * cell + 8;
  const H = labelTop + n * cell + 8;

  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);

  return (
    <div className="panel">
      <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className={`ghost small ${!onlyMacros ? 'chip-active' : ''}`} onClick={() => setOnlyMacros(false)}>
          Tous les nutriments
        </button>
        <button className={`ghost small ${onlyMacros ? 'chip-active' : ''}`} onClick={() => setOnlyMacros(true)}>
          Macros seulement
        </button>
      </div>
      <p className="small" style={{ marginTop: 0 }}>
        Corrélation de Pearson entre nutriments sur les {explorable.length} aliments (pour 100 g).
        <span style={{ color: C.accent }}> Bleu</span> = varient ensemble,
        <span style={{ color: C.danger }}> rouge</span> = varient à l'inverse, sombre ≈ indépendants.
      </p>

      <div style={{ overflowX: 'auto', position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: n > 12 ? W : '100%', maxWidth: '100%', display: 'block' }}>
          {/* étiquettes colonnes (haut, pivotées) */}
          {keys.map((k, j) => (
            <text
              key={`c${k}`}
              transform={`translate(${labelW + j * cell + cell / 2} ${labelTop - 6}) rotate(-55)`}
              fill={hover?.j === j || hover?.i === j ? C.text : C.muted}
              fontSize={onlyMacros ? 11 : 9}
              textAnchor="start"
            >
              {NUT_LABEL.get(k)}
            </text>
          ))}
          {/* étiquettes lignes (gauche) */}
          {keys.map((k, i) => (
            <text
              key={`r${k}`}
              x={labelW - 6}
              y={labelTop + i * cell + cell / 2}
              fill={hover?.i === i || hover?.j === i ? C.text : C.muted}
              fontSize={onlyMacros ? 11 : 9}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {NUT_LABEL.get(k)}
            </text>
          ))}
          {/* cellules */}
          {matrix.map((row, i) =>
            row.map((r, j) => (
              <g key={`${i}-${j}`}>
                <rect
                  x={labelW + j * cell}
                  y={labelTop + i * cell}
                  width={cell - 1.5}
                  height={cell - 1.5}
                  rx={2}
                  fill={corrColor(r)}
                  stroke={hover?.i === i && hover?.j === j ? C.text : 'none'}
                  strokeWidth={1.5}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHover({ i, j })}
                  onMouseLeave={() => setHover(null)}
                />
                {(onlyMacros || Math.abs(r) >= 0.55) && i !== j && (
                  <text
                    x={labelW + j * cell + (cell - 1.5) / 2}
                    y={labelTop + i * cell + (cell - 1.5) / 2}
                    fill={Math.abs(r) > 0.4 ? '#fff' : C.muted}
                    fontSize={onlyMacros ? 10 : 8}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                  >
                    {r.toFixed(onlyMacros ? 2 : 1)}
                  </text>
                )}
              </g>
            )),
          )}
        </svg>
      </div>

      {hover && (
        <div className="small" style={{ marginTop: 10, color: C.text }}>
          <strong>{NUT_LABEL.get(keys[hover.i])}</strong> × <strong>{NUT_LABEL.get(keys[hover.j])}</strong> :{' '}
          <span className="mono" style={{ color: Math.abs(matrix[hover.i][hover.j]) < 0.2 ? C.muted : matrix[hover.i][hover.j] >= 0 ? C.accent : C.danger }}>
            r = {matrix[hover.i][hover.j].toFixed(2)}
          </span>{' '}
          {corrLabel(matrix[hover.i][hover.j])}
        </div>
      )}
    </div>
  );
}

function corrLabel(r: number): string {
  const a = Math.abs(r);
  const dir = r >= 0 ? 'positive' : 'négative';
  if (a >= 0.7) return `— corrélation ${dir} forte`;
  if (a >= 0.4) return `— corrélation ${dir} modérée`;
  if (a >= 0.2) return `— corrélation ${dir} faible`;
  return '— quasi indépendants';
}

// ===========================================================================
// Vue 3 — Coordonnées parallèles (profil multi-nutriments)
// ===========================================================================

const DEFAULT_AXES: NutrientKey[] = ['kcal', 'proteines', 'lipides', 'glucides', 'fibres', 'fer', 'calcium'];

function ParallelView() {
  const [axes, setAxes] = useState<NutrientKey[]>(DEFAULT_AXES);
  const [focusCat, setFocusCat] = useState<FoodCategory | 'all'>('all');
  const explorable = useExplorable();
  const W = 720;
  const H = 420;
  const m = { top: 26, right: 24, bottom: 34, left: 24 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ id: string; nom: string; px: number; py: number } | null>(null);

  // Échelle par axe : 0 → 95e centile (limite l'écrasement par les valeurs extrêmes).
  const scales = useMemo(() => {
    return axes.map((k) => {
      const vals = explorable.map((f) => val(f, k)).sort((a, b) => a - b);
      const cap = quantile(vals, 0.95) || d3max(vals) || 1;
      return scaleLinear().domain([0, cap || 1]).range([H - m.bottom, m.top]);
    });
  }, [explorable, axes]);

  const xFor = (i: number) => m.left + (i * (W - m.left - m.right)) / Math.max(1, axes.length - 1);

  const lines = useMemo(
    () =>
      explorable.map((f) => ({
        f,
        d: axes
          .map((k, i) => {
            const y = scales[i](Math.min(val(f, k), scales[i].domain()[1]));
            return `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${y}`;
          })
          .join(' '),
      })),
    [explorable, axes, scales],
  );

  function toggleAxis(k: NutrientKey) {
    setAxes((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  }

  return (
    <>
      <div className="panel">
        <div className="small" style={{ marginBottom: 8 }}>Axes (nutriments) — cliquez pour ajouter/retirer</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {NUT.map((nn) => (
            <button
              key={nn.key}
              className={`ghost small ${axes.includes(nn.key) ? 'chip-active' : ''}`}
              onClick={() => toggleAxis(nn.key)}
            >
              {nn.label}
            </button>
          ))}
        </div>
        <div className="small" style={{ margin: '12px 0 8px' }}>Mettre en avant une catégorie</div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button className={`ghost small ${focusCat === 'all' ? 'chip-active' : ''}`} onClick={() => setFocusCat('all')}>
            Toutes
          </button>
          {CATS.map((c) => (
            <button
              key={c.key}
              className="ghost small"
              style={{ borderColor: focusCat === c.key ? c.color : C.border, background: focusCat === c.key ? c.color : undefined, color: focusCat === c.key ? '#fff' : undefined }}
              onClick={() => setFocusCat((v) => (v === c.key ? 'all' : c.key))}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        {axes.length < 2 ? (
          <div className="empty">Sélectionnez au moins deux axes.</div>
        ) : (
          <div style={{ position: 'relative', overflowX: 'auto' }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              style={{ width: axes.length > 7 ? W : '100%', maxWidth: '100%', display: 'block' }}
              onMouseLeave={() => setHover(null)}
            >
              {/* axes verticaux + graduations */}
              {axes.map((k, i) => {
                const sc = scales[i];
                const ticks = sc.ticks(4);
                return (
                  <g key={k}>
                    <line x1={xFor(i)} x2={xFor(i)} y1={m.top} y2={H - m.bottom} stroke={C.border} strokeWidth={1.5} />
                    {ticks.map((t) => (
                      <g key={t}>
                        <line x1={xFor(i) - 3} x2={xFor(i) + 3} y1={sc(t)} y2={sc(t)} stroke={C.muted} strokeWidth={1} />
                        <text x={xFor(i) + 6} y={sc(t)} fill={C.muted} fontSize={8} dominantBaseline="middle">
                          {fmt(t, t < 1 ? 1 : 0)}
                        </text>
                      </g>
                    ))}
                    <text x={xFor(i)} y={m.top - 10} fill={C.text} fontSize={10} textAnchor="middle">
                      {NUT_LABEL.get(k)}
                    </text>
                    <text x={xFor(i)} y={H - m.bottom + 16} fill={C.muted} fontSize={8} textAnchor="middle">
                      {NUT_UNIT.get(k)}
                    </text>
                  </g>
                );
              })}

              {/* lignes aliments */}
              {lines.map(({ f, d }) => {
                const dim = focusCat !== 'all' && f.categorie !== focusCat;
                const isHover = hover?.id === f.id;
                return (
                  <path
                    key={f.id}
                    d={d}
                    fill="none"
                    stroke={COLOR_BY_CAT.get(f.categorie)}
                    strokeWidth={isHover ? 2.6 : 1.2}
                    opacity={isHover ? 1 : dim ? 0.06 : 0.4}
                    style={{ cursor: 'pointer' }}
                    onMouseMove={(e) => {
                      if (svgRef.current) {
                        const v = toViewBox(e, svgRef.current, W, H);
                        setHover({ id: f.id, nom: f.nom, px: v.px, py: v.py });
                      }
                    }}
                  />
                );
              })}
            </svg>

            {hover && (
              <Tooltip px={hover.px} py={hover.py}>
                <strong>{hover.nom}</strong>
              </Tooltip>
            )}
          </div>
        )}
        <p className="small" style={{ marginBottom: 0 }}>
          Chaque ligne = un aliment, son profil lu de gauche à droite. Échelle de chaque axe bornée au 95ᵉ centile.
          Survolez une ligne pour l'isoler.
        </p>
      </div>
    </>
  );
}
