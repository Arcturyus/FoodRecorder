import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog, scaleSqrt } from 'd3-scale';
import { extent, max as d3max, mean as d3mean, quantile } from 'd3-array';
import { RDA } from '../nutrition/rda';
import { useTargets } from './useTargets';
import { portionGrams } from '../nutrition/recommend';
import type { Food, FoodCategory, NutrientKey } from '../nutrition/types';
import { fmt } from './format';

/**
 * « Explorer visuel » : atelier de visualisation D3 de la banque d'aliments, pour
 * lire la table sous plusieurs angles (données pour 100 g). Deux vues :
 *  - Nuage de points / bulles : deux (ou trois) nutriments croisés, frontière de
 *    Pareto pour repérer p. ex. « max protéines / min kcal » ;
 *  - Matrice de corrélation : liens statistiques entre tous les nutriments.
 * On reste volontairement en D3 pur (SVG maison, d3-scale/array/shape).
 */

/**
 * Palette alignée sur les variables CSS du thème (dark, marron). `accent` et
 * `danger` restent bleu/rouge : ce sont les couleurs du dégradé divergent de la
 * matrice de corrélation (cf. corrColor), pas des couleurs de thème — elles
 * doivent correspondre exactement aux cellules qu'elles légendent.
 */
const C = {
  accent: '#5b8cff',
  accent2: '#7bc96f', // = --accent-2
  warn: '#f5a623', // = --warn
  danger: '#ef5d5d',
  muted: '#a89f8f', // = --muted
  border: '#35302a', // = --border
  text: '#f0ece4', // = --text
  panel: '#1b1815', // = --panel
  panel2: '#242019', // = --panel-2
};

/** Couleur par catégorie d'aliment (encodage constant sur toutes les vues). */
export const CATS: { key: FoodCategory; label: string; color: string }[] = [
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
export const COLOR_BY_CAT = new Map(CATS.map((c) => [c.key, c.color]));

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

export type ParetoPoint = { id: string; x: number; y: number };

/**
 * Frontière de Pareto pour des objectifs quelconques (min/max sur chaque axe).
 * Un point est retenu s'il n'est dominé par aucun autre : « dominé » = un point
 * au moins aussi bon sur les deux axes et strictement meilleur sur au moins un.
 *
 * Cas particulier : la dominance stricte élimine les ex æquo sur la valeur-plancher/
 * plafond d'un axe (ex. « minimiser les AG saturés » → tous les aliments à 0 g sont
 * déjà indépassables sur cet axe, mais seul celui avec le plus de protéines survivrait
 * à la dominance classique, masquant tous les autres aliments à 0 g). On les réintègre
 * explicitement : un point qui atteint la meilleure valeur possible d'un axe reste
 * toujours dans la frontière, quel que soit son score sur l'autre axe.
 */
export function paretoFrontier<P extends ParetoPoint>(points: P[], xGoal: 'min' | 'max', yGoal: 'min' | 'max'): P[] {
  if (points.length === 0) return [];
  const okX = (a: number, b: number) => (xGoal === 'max' ? a >= b : a <= b);
  const okY = (a: number, b: number) => (yGoal === 'max' ? a >= b : a <= b);
  const gtX = (a: number, b: number) => (xGoal === 'max' ? a > b : a < b);
  const gtY = (a: number, b: number) => (yGoal === 'max' ? a > b : a < b);
  const standard = points.filter(
    (p) => !points.some((q) => q !== p && okX(q.x, p.x) && okY(q.y, p.y) && (gtX(q.x, p.x) || gtY(q.y, p.y))),
  );

  const xBest = xGoal === 'max' ? Math.max(...points.map((p) => p.x)) : Math.min(...points.map((p) => p.x));
  const yBest = yGoal === 'max' ? Math.max(...points.map((p) => p.y)) : Math.min(...points.map((p) => p.y));
  const atBest = points.filter((p) => p.x === xBest || p.y === yBest);

  const merged = new Map(standard.map((p) => [p.id, p]));
  for (const p of atBest) merged.set(p.id, p);
  return Array.from(merged.values()).sort((a, b) => a.x - b.x || a.y - b.y);
}

type View = 'nuage' | 'correlation';

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
        </div>
      </div>

      {view === 'nuage' && <ScatterView />}
      {view === 'correlation' && <CorrelationView />}

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

/** Transform de zoom/pan façon d3.zoom : k = facteur d'échelle, x/y = décalage en pixels. */
type ZoomTransform = { k: number; x: number; y: number };
const ZOOM_IDENTITY: ZoomTransform = { k: 1, x: 0, y: 0 };
const ZOOM_MIN = 1;
const ZOOM_MAX = 24;

/**
 * Rééchelonne une échelle continue (linéaire ou log) pour refléter un zoom/pan en
 * pixels : le domaine visible change, l'intervalle de pixels (range) reste fixe —
 * même principe que `d3.zoomTransform().rescaleX()`, réimplémenté ici pour éviter
 * une dépendance à d3-zoom. `minPositive` évite un domaine ≤ 0 en échelle log
 * (log(0) indéfini) si l'utilisateur dézoome/déplace au-delà de la vue d'origine.
 */
export function rescaleAxis<S extends { range(): number[]; invert(v: number): number; copy(): S; domain(d: Iterable<number>): S }>(
  base: S,
  { k, t }: { k: number; t: number },
  minPositive?: number,
): S {
  const [r0, r1] = base.range();
  const inv = (px: number) => (px - t) / k;
  let d0 = base.invert(inv(r0));
  let d1 = base.invert(inv(r1));
  if (minPositive != null) {
    d0 = Math.max(d0, minPositive);
    d1 = Math.max(d1, minPositive * 1.0001);
  }
  return base.copy().domain([d0, d1]);
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
  const [logX, setLogX] = useState(true);
  const [logY, setLogY] = useState(true);
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
  const targets = useTargets();
  const tx = targets.find((r) => r.key === xk);
  const ty = targets.find((r) => r.key === yk);

  // Zoom / pan (molette + glisser). Transform en pixels, indépendant des échelles :
  // on l'applique en rééchelonnant xs/ys (cf. rescaleAxis), pas en transformant le
  // SVG (évite de déformer les libellés texte au zoom).
  const [zoomX, setZoomX] = useState<ZoomTransform>(ZOOM_IDENTITY);
  const [zoomY, setZoomY] = useState<ZoomTransform>(ZOOM_IDENTITY);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // Un changement d'axes/filtre rend l'ancien cadrage obsolète.
  useEffect(() => {
    setZoomX(ZOOM_IDENTITY);
    setZoomY(ZOOM_IDENTITY);
  }, [xk, yk, sizeK, hideCats, logX, logY]);

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

  // Molette/trackpad : Ctrl (ou pincement, que les navigateurs synthétisent en
  // wheel + ctrlKey) zoome vers le curseur. Un simple défilement (molette de
  // souris, ou glisser à deux doigts sur trackpad SANS pincer) déplace la vue
  // au lieu de zoomer — sinon ce geste de « scroll » se traduisait par un zoom
  // non désiré à la place d'un simple déplacement.
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

  // Pointeurs actifs (pour le pincer-zoomer tactile à deux doigts) et pincement
  // en cours (distance + centre courants, pour calculer le facteur de zoom).
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ dist: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
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

  // Un aliment sans donnée mesurée équivaut à 0 (pas exclu) : voir EMPTY_NUTRIENTS.
  // Seuls les points sans AUCUNE valeur sur les deux axes (0 partout) sont retirés,
  // sans lien avec l'échelle log — sinon un aliment à 0 g sur un axe minimisé (ex.
  // AG saturés des légumes) disparaîtrait alors qu'il a une vraie valeur.
  const points = useMemo(() => {
    return explorable
      .filter((f) => !hideCats.has(f.categorie))
      .map((f) => ({ f, x: val(f, xk), y: val(f, yk), s: sizeK === 'none' ? 0 : val(f, sizeK) }))
      .filter((p) => p.x > 0 || p.y > 0);
  }, [explorable, xk, yk, sizeK, hideCats]);

  const frontier = useMemo(
    () => paretoFrontier(points.map((p) => ({ ...p, id: p.f.id })), xGoal, yGoal),
    [points, xGoal, yGoal],
  );
  const frontierSet = useMemo(() => new Set(frontier.map((p) => p.f.id)), [frontier]);

  if (points.length === 0) {
    return <div className="panel"><div className="empty">Aucun aliment à tracer avec ces axes.</div></div>;
  }

  // Échelle log : indéfinie en 0 (log(0) = −∞). Plutôt que d'exclure ces aliments
  // (ex. tous les légumes à 0 g d'AG saturés), on leur réserve une « voie zéro »
  // séparée, à gauche/en bas du repère log, avec un séparateur pointillé + étiquette « 0 ».
  const ZERO_LANE = 26;
  const xPositives = points.map((p) => p.x).filter((v) => v > 0);
  const yPositives = points.map((p) => p.y).filter((v) => v > 0);
  const hasZeroX = logX && points.some((p) => p.x <= 0);
  const hasZeroY = logY && points.some((p) => p.y <= 0);

  const [, x1] = extent(points, (p) => p.x) as [number, number];
  const [, y1] = extent(points, (p) => p.y) as [number, number];

  const xRange: [number, number] = hasZeroX ? [m.left + ZERO_LANE, W - m.right] : [m.left, W - m.right];
  const yRange: [number, number] = hasZeroY ? [H - m.bottom - ZERO_LANE, m.top] : [H - m.bottom, m.top];

  // Marge par défaut autour des données : sans elle, l'aliment le plus extrême
  // se retrouve pile sur le bord du cadre (coupé au survol/zoom). LOG_PAD est
  // multiplicatif (échelle log), LIN_PAD s'applique avant `.nice()`.
  const LOG_PAD = 1.15;
  const LIN_PAD = 1.06;
  const xs = logX
    ? scaleLog().domain([(xPositives.length ? Math.min(...xPositives) : 0.01) / LOG_PAD, (d3max(xPositives) || 1) * LOG_PAD]).range(xRange)
    : scaleLinear().domain([0, (x1 || 1) * LIN_PAD]).nice().range(xRange);
  const ys = logY
    ? scaleLog().domain([(yPositives.length ? Math.min(...yPositives) : 0.01) / LOG_PAD, (d3max(yPositives) || 1) * LOG_PAD]).range(yRange)
    : scaleLinear().domain([0, (y1 || 1) * LIN_PAD]).nice().range(yRange);

  // Échelles « vue » : mêmes pixels, domaine visible ajusté par le zoom/pan courant.
  const vxs = rescaleAxis(xs, { k: zoomX.k, t: zoomX.x }, logX ? xs.domain()[0] : undefined);
  const vys = rescaleAxis(ys, { k: zoomY.k, t: zoomY.y }, logY ? ys.domain()[0] : undefined);

  const zeroX = m.left + ZERO_LANE / 2;
  const zeroY = H - m.bottom - ZERO_LANE / 2;
  const cx = (x: number) => (logX && x <= 0 ? zeroX : vxs(x));
  const cy = (y: number) => (logY && y <= 0 ? zeroY : vys(y));

  const sMax = sizeK === 'none' ? 1 : d3max(points, (p) => p.s) || 1;
  const rs = scaleSqrt().domain([0, sMax]).range([3, 22]);
  const radius = (s: number) => (sizeK === 'none' ? 5 : Math.max(3, rs(s)));

  const xTicks = vxs.ticks(logX ? 4 : 6);
  const yTicks = vys.ticks(6);

  // Médianes → repères de « quadrant valeur ».
  const medX = quantile(points.map((p) => p.x).sort((a, b) => a - b), 0.5) ?? 0;
  const medY = quantile(points.map((p) => p.y).sort((a, b) => a - b), 0.5) ?? 0;

  const frontierPath = frontier.map((p, i) => `${i === 0 ? 'M' : 'L'} ${cx(p.x)} ${cy(p.y)}`).join(' ');

  return (
    <>
      <div className="panel">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <NutSelect label="Axe X" value={xk} onChange={(k) => setXk(k as NutrientKey)} />
          <NutSelect label="Axe Y" value={yk} onChange={(k) => setYk(k as NutrientKey)} />
          <NutSelect label="Taille des bulles" value={sizeK} onChange={setSizeK} allowNone />
        </div>
        <div className="row small" style={{ gap: 14, marginTop: 8 }}>
          <span><i className="ref-legend ajr" /> AJR (100 g qui couvre le besoin du jour)</span>
          <span><i className="ref-legend opti" /> Optimal (cible perf/santé)</span>
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
            style={{ width: '100%', display: 'block', touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
            onMouseLeave={() => setHover(null)}
            onClick={() => setHover(null)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <defs>
              <clipPath id="scatter-clip">
                <rect x={m.left} y={m.top} width={W - m.left - m.right} height={H - m.top - m.bottom} />
              </clipPath>
            </defs>

            {/* grille */}
            {xTicks.map((t) => (
              <line key={`gx${t}`} x1={vxs(t)} x2={vxs(t)} y1={m.top} y2={H - m.bottom} stroke={C.border} strokeWidth={1} opacity={0.5} />
            ))}
            {yTicks.map((t) => (
              <line key={`gy${t}`} x1={m.left} x2={W - m.right} y1={vys(t)} y2={vys(t)} stroke={C.border} strokeWidth={1} opacity={0.5} />
            ))}

            {/* voie zéro (échelle log) : sépare les aliments à 0, indépassable en log */}
            {hasZeroX && (
              <>
                <line x1={m.left + ZERO_LANE} x2={m.left + ZERO_LANE} y1={m.top} y2={H - m.bottom} stroke={C.border} strokeWidth={1} strokeDasharray="2 3" />
                <text x={zeroX} y={H - m.bottom + 16} fill={C.muted} fontSize={10} textAnchor="middle">0</text>
              </>
            )}
            {hasZeroY && (
              <>
                <line x1={m.left} x2={W - m.right} y1={H - m.bottom - ZERO_LANE} y2={H - m.bottom - ZERO_LANE} stroke={C.border} strokeWidth={1} strokeDasharray="2 3" />
                <text x={m.left - 8} y={zeroY} fill={C.muted} fontSize={10} textAnchor="end" dominantBaseline="middle">0</text>
              </>
            )}

            {/* médianes */}
            <line x1={cx(medX)} x2={cx(medX)} y1={m.top} y2={H - m.bottom} stroke={C.muted} strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />
            <line x1={m.left} x2={W - m.right} y1={cy(medY)} y2={cy(medY)} stroke={C.muted} strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />

            {/*
              Repères AJR / optimal (profil utilisateur) : à quelle valeur pour 100 g
              cet axe atteint le besoin du jour. Un aliment situé au-delà de ce repère
              couvre déjà tout l'AJR (ou la cible optimale) rien qu'avec 100 g — ça
              répond directement à « cet aliment rapporte-t-il beaucoup ou non ».
              Les positions sont bornées au cadre du graphique (pas de clipPath ici),
              sinon un AJR hors échelle (ex. kcal/j, bien plus grand que 100 g de
              n'importe quel aliment) déborderait sur les axes/étiquettes.
            */}
            {tx && tx.ajr > 0 && cx(tx.ajr) >= m.left && cx(tx.ajr) <= W - m.right && (
              <line x1={cx(tx.ajr)} x2={cx(tx.ajr)} y1={m.top} y2={H - m.bottom} stroke={C.text} strokeWidth={1} strokeDasharray="1 3" opacity={0.5} />
            )}
            {tx && tx.optimal > 0 && tx.optimal !== tx.ajr && cx(tx.optimal) >= m.left && cx(tx.optimal) <= W - m.right && (
              <line x1={cx(tx.optimal)} x2={cx(tx.optimal)} y1={m.top} y2={H - m.bottom} stroke={C.accent2} strokeWidth={1} strokeDasharray="5 2" opacity={0.8} />
            )}
            {ty && ty.ajr > 0 && cy(ty.ajr) >= m.top && cy(ty.ajr) <= H - m.bottom && (
              <line x1={m.left} x2={W - m.right} y1={cy(ty.ajr)} y2={cy(ty.ajr)} stroke={C.text} strokeWidth={1} strokeDasharray="1 3" opacity={0.5} />
            )}
            {ty && ty.optimal > 0 && ty.optimal !== ty.ajr && cy(ty.optimal) >= m.top && cy(ty.optimal) <= H - m.bottom && (
              <line x1={m.left} x2={W - m.right} y1={cy(ty.optimal)} y2={cy(ty.optimal)} stroke={C.accent2} strokeWidth={1} strokeDasharray="5 2" opacity={0.8} />
            )}

            {/* axes ticks labels */}
            {xTicks.map((t) => (
              <text key={`xt${t}`} x={vxs(t)} y={H - m.bottom + 16} fill={C.muted} fontSize={10} textAnchor="middle">
                {fmt(t, t < 1 ? 1 : 0)}
              </text>
            ))}
            {yTicks.map((t) => (
              <text key={`yt${t}`} x={m.left - 8} y={vys(t)} fill={C.muted} fontSize={10} textAnchor="end" dominantBaseline="middle">
                {fmt(t, t < 1 ? 1 : 0)}
              </text>
            ))}
            <text x={(m.left + W - m.right) / 2} y={H - 6} fill={C.text} fontSize={11} textAnchor="middle">
              {axisTitle(xk)}{logX ? ' · log' : ''}
            </text>
            <text transform={`translate(14 ${(m.top + H - m.bottom) / 2}) rotate(-90)`} fill={C.text} fontSize={11} textAnchor="middle">
              {axisTitle(yk)}{logY ? ' · log' : ''}
            </text>

            {/* frontière + points : clippés au cadre du graphique (zoom/pan peut les déplacer hors cadre) */}
            <g clipPath="url(#scatter-clip)">
              {pareto && frontier.length > 1 && (
                <path d={frontierPath} fill="none" stroke={C.accent2} strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />
              )}
              {points.map((p, i) => {
                const onFront = pareto && frontierSet.has(p.f.id);
                const isHover = hover?.i === i;
                const r = radius(p.s);
                // Zone de tap agrandie et invisible : sur mobile, les bulles réelles (souvent
                // 3-8 px) sont trop petites pour viser précisément au doigt. Le survol (souris)
                // continue de fonctionner sur cette même zone.
                const hitR = Math.max(r + 10, 16);
                return (
                  <g key={p.f.id}>
                    <circle
                      cx={cx(p.x)}
                      cy={cy(p.y)}
                      r={r * (isHover ? 1.35 : 1)}
                      fill={COLOR_BY_CAT.get(p.f.categorie)}
                      fillOpacity={onFront ? 0.95 : 0.72}
                      stroke={onFront ? C.accent2 : isHover ? C.text : 'none'}
                      strokeWidth={onFront ? 2 : isHover ? 1.5 : 0}
                      pointerEvents="none"
                    />
                    <circle
                      cx={cx(p.x)}
                      cy={cy(p.y)}
                      r={hitR}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        if (svgRef.current) {
                          const v = toViewBox(e, svgRef.current, W, H);
                          setHover({ i, px: v.px, py: v.py });
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (svgRef.current) {
                          const v = toViewBox(e, svgRef.current, W, H);
                          setHover((h) => (h?.i === i ? null : { i, px: v.px, py: v.py }));
                        }
                      }}
                    />
                  </g>
                );
              })}
            </g>
          </svg>

          {hover && (() => {
            const p = points[hover.i];
            const portionG = portionGrams(p.f);
            const factor = portionG / 100;
            // % AJR / optimal pour la portion réaliste de l'aliment (pas les 100 g
            // de l'axe) : c'est ce qu'on mange vraiment qui répond à « ça rapporte
            // beaucoup ou non », d'où un calcul distinct des repères de l'échelle.
            const detail = (k: NutrientKey, per100: number) => {
              const t = targets.find((r) => r.key === k);
              if (!t || t.ajr <= 0) return null;
              const amount = per100 * factor;
              return {
                amount,
                unit: t.unit,
                pctAjr: (amount / t.ajr) * 100,
                pctOpt: t.optimal > 0 && t.optimal !== t.ajr ? (amount / t.optimal) * 100 : null,
              };
            };
            const dx = detail(xk, p.x);
            const dy = detail(yk, p.y);
            return (
              <Tooltip px={hover.px} py={hover.py}>
                <strong>{p.f.nom}</strong>
                {frontierSet.has(p.f.id) && pareto && <span style={{ color: C.accent2 }}> · Pareto</span>}
                <br />
                {NUT_LABEL.get(xk)} : {fmt(p.x, p.x < 10 ? 1 : 0)} {NUT_UNIT.get(xk)} /100 g
                <br />
                {NUT_LABEL.get(yk)} : {fmt(p.y, p.y < 10 ? 1 : 0)} {NUT_UNIT.get(yk)} /100 g
                {sizeK !== 'none' && (
                  <>
                    <br />
                    {NUT_LABEL.get(sizeK)} : {fmt(p.s, p.s < 10 ? 1 : 0)} {NUT_UNIT.get(sizeK)}
                  </>
                )}
                <br />
                <span style={{ color: C.muted }}>Portion ≈ {fmt(portionG)} g</span>
                {dx && (
                  <>
                    <br />
                    {fmt(dx.amount, dx.amount < 10 ? 1 : 0)} {dx.unit} de {NUT_LABEL.get(xk)} · {fmt(dx.pctAjr)} % AJR
                    {dx.pctOpt != null ? ` · ${fmt(dx.pctOpt)} % opti` : ''}
                  </>
                )}
                {dy && (
                  <>
                    <br />
                    {fmt(dy.amount, dy.amount < 10 ? 1 : 0)} {dy.unit} de {NUT_LABEL.get(yk)} · {fmt(dy.pctAjr)} % AJR
                    {dy.pctOpt != null ? ` · ${fmt(dy.pctOpt)} % opti` : ''}
                  </>
                )}
              </Tooltip>
            );
          })()}
        </div>
        <p className="small" style={{ marginTop: 0 }}>
          Ctrl + molette (ou pincer à deux doigts) pour zoomer, glisser (un doigt ou la souris) pour déplacer. Les
          zones à 0 (voie séparée) restent fixes.
        </p>
        {(hasZeroX || hasZeroY) && (
          <p className="small" style={{ marginBottom: pareto ? undefined : 0 }}>
            Repère « 0 » pointillé : une échelle log ne peut pas représenter zéro, donc les aliments à 0{' '}
            {hasZeroX && !hasZeroY ? NUT_LABEL.get(xk) : hasZeroY && !hasZeroX ? NUT_LABEL.get(yk) : `${NUT_LABEL.get(xk)}/${NUT_LABEL.get(yk)}`}{' '}
            sont affichés à part, plutôt que masqués.
          </p>
        )}
        {pareto && (
          <p className="small" style={{ marginBottom: 0 }}>
            Ligne verte = <strong>frontière de Pareto</strong> : les {frontier.length} aliments qu'aucun autre ne
            surpasse à la fois en {NUT_LABEL.get(yk)} ({yGoal === 'max' ? 'plus' : 'moins'}) et en{' '}
            {NUT_LABEL.get(xk)} ({xGoal === 'max' ? 'plus' : 'moins'}), plus tous ceux déjà à la valeur limite
            (ex. 0 g) sur un axe minimisé/maximisé — indépassables sur cet axe, quel que soit l'autre. Pointillés
            gris = médianes, clairs = AJR, verts = optimal (100 g qui couvrent le besoin du jour, selon votre profil).
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
  const MACRO_KEYS: NutrientKey[] = ['kcal', 'proteines', 'glucides', 'lipides', 'fibres', 'agSatures', 'agTrans', 'agMonoInsatures', 'agPolyInsatures', 'omega3', 'omega6', 'omega9'];
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

