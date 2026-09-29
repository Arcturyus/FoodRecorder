import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog, scaleSqrt } from 'd3-scale';
import { extent, max as d3max, mean as d3mean } from 'd3-array';
import { symbol, symbolCircle, symbolDiamond, symbolSquare, symbolTriangle } from 'd3-shape';
import type { SymbolType } from 'd3-shape';
import { RDA } from '../nutrition/rda';
import { NUTRIENT_GROUPS } from '../nutrition/groups';
import { useTargets } from './useTargets';
import { portionGrams } from '../nutrition/recommend';
import { normalizeForMatch } from '../nutrition/normalize';
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

const SUPPLEMENT_COLOR = '#b084f5';

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
  { key: 'supplement', label: 'Suppléments', color: SUPPLEMENT_COLOR },
];
export const COLOR_BY_CAT = new Map<FoodCategory, string>(CATS.map((c) => [c.key, c.color]));

/**
 * Forme par catégorie, en plus de la couleur. Douze catégories ne tiennent pas
 * dans une palette où chacune se distingue au premier coup d'œil : Fruits
 * (#ef6f6f), Viandes (#c8603f) et Sucré/snacks (#d16ba5) sont trois rouges
 * voisins, Légumes et Matières grasses deux verts. La répartition ci-dessous
 * n'a qu'une règle — deux couleurs proches n'ont jamais la même forme —, ce qui
 * règle du même coup le daltonisme, où la couleur seule ne dit rien.
 */
const SHAPE_BY_CAT = new Map<FoodCategory, SymbolType>([
  ['legume', symbolCircle],
  ['fruit', symbolCircle],
  ['poisson', symbolCircle],
  ['feculent', symbolCircle],
  ['viande', symbolSquare],
  ['matiere-grasse', symbolSquare],
  ['boisson', symbolSquare],
  ['oeuf-laitier', symbolSquare],
  ['sucre-snack', symbolTriangle],
  ['plat', symbolTriangle],
  ['autre', symbolTriangle],
  ['supplement', symbolDiamond],
]);

/**
 * Chemin SVG de la marque d'une catégorie, centré sur (0, 0). `r` est le rayon
 * du cercle ÉQUIVALENT : d3 dimensionne ses symboles par l'aire, donc passer
 * π·r² laisse un carré et un triangle peser visuellement autant que le cercle
 * qu'ils remplacent — l'encodage de la taille des bulles est inchangé.
 */
export function catSymbolPath(cat: FoodCategory, r: number): string {
  return symbol(SHAPE_BY_CAT.get(cat) ?? symbolCircle, Math.PI * r * r)() ?? '';
}

/** Pastille « forme + couleur » d'une catégorie, pour les légendes et les filtres. */
export function CatIcon({ cat, size = 13 }: { cat: FoodCategory; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden style={{ flex: '0 0 auto' }}>
      <path
        transform={`translate(${size / 2} ${size / 2})`}
        d={catSymbolPath(cat, size * 0.34)}
        fill={COLOR_BY_CAT.get(cat)}
      />
    </svg>
  );
}

/**
 * Aliments explorables : on retire les compléments (produits purs très concentrés,
 * ex. comprimé de vitamine C) qui écraseraient toutes les échelles des graphiques.
 */
/**
 * Aliments explorables fournis par le parent (banque avec overrides + perso),
 * partagés aux sous-vues via un contexte pour éviter de tout re-câbler en props.
 * Les compléments sont retirés de ce jeu de base, puis ajoutés au nuage derrière
 * le filtre de catégorie « Suppléments ».
 */
const ExplorableCtx = createContext<Food[]>([]);
const useExplorable = () => useContext(ExplorableCtx);
const SupplementsCtx = createContext<Food[]>([]);
const useSupplements = () => useContext(SupplementsCtx);

/**
 * Ids des aliments présents pour la comparaison mais **jamais mangés** (catalogue
 * ajouté à la demande). Ils sont tracés en pointillés : sans ce marquage, un
 * Pareto ne dirait plus si sa frontière est faite de ce qu'on mange ou de ce qu'on
 * pourrait manger — deux lectures opposées.
 */
const NeverEatenCtx = createContext<ReadonlySet<string>>(new Set());
const useNeverEaten = () => useContext(NeverEatenCtx);

/** Le prix partage les graphiques avec les nutriments, mais n'a ni AJR ni cible de santé. */
type ChartKey = NutrientKey | 'prix';
const NUT: { key: ChartKey; label: string; unit: string }[] = [
  { key: 'prix', label: 'Prix', unit: '€/kg' },
  ...RDA.map((r) => ({ key: r.key, label: r.label, unit: r.unit })),
];
const NUT_LABEL = new Map(NUT.map((n) => [n.key, n.label]));
const NUT_UNIT = new Map(NUT.map((n) => [n.key, n.unit]));

const val = (f: Food, k: ChartKey) => k === 'prix' ? f.price?.eurPerKg ?? Number.NaN : f.n[k];
const axisTitle = (k: ChartKey) => k === 'prix' ? 'Prix (€/kg)' : `${NUT_LABEL.get(k)} (${NUT_UNIT.get(k)}) /100 g`;
const pointValue = (k: ChartKey, amount: number) => k === 'prix' ? `${fmt(amount, 2)} €/kg` : `${fmt(amount, amount < 10 ? 1 : 0)} ${NUT_UNIT.get(k)} /100 g`;

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
export function paretoFrontier<P extends ParetoPoint>(points: P[], xGoal: 'min' | 'max', yGoal: 'min' | 'max', includeAxisExtremes = true): P[] {
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
  const atBest = includeAxisExtremes ? points.filter((p) => p.x === xBest || p.y === yBest) : [];

  const merged = new Map(standard.map((p) => [p.id, p]));
  for (const p of atBest) merged.set(p.id, p);
  return Array.from(merged.values()).sort((a, b) => a.x - b.x || a.y - b.y);
}

/** Un point de la frontière à nommer : sa position à l'écran et son rayon dessiné. */
export interface LabelInput {
  text: string;
  /** Coordonnées dans le repère du viewBox, pas en pixels d'écran. */
  x: number;
  y: number;
  r: number;
}

/** Étiquette posée : position de la ligne de base et côté d'ancrage. */
export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'end';
}

/** Cadre utile du graphique (hors marges d'axes). */
export interface LabelFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Au-delà, un nom mange le graphe : on le coupe plutôt que de renoncer à l'afficher. */
const LABEL_MAX_CHARS = 18;
/** Largeur moyenne d'un caractère à fontSize 10 dans la police de l'app. */
const LABEL_CHAR_W = 5.5;
const LABEL_H = 11;

/**
 * Place les étiquettes des aliments de la frontière de Pareto en évitant les
 * collisions. Le nuage n'affichait aucun nom : la frontière est pourtant la
 * raison d'être de la vue (« qu'est-ce qui maximise X en minimisant Y ? ») et la
 * réponse était huit ronds anonymes qu'il fallait survoler un par un.
 *
 * Quatre positions sont essayées autour du point (haut-droite d'abord, la plus
 * lisible), et l'étiquette est ABANDONNÉE si aucune ne tient : huit noms lisibles
 * valent mieux que douze superposés. Les boîtes sont estimées, pas mesurées —
 * mesurer chaque texte imposerait un rendu en deux passes pour un gain nul à
 * cette taille.
 *
 * Fonction pure (coordonnées du viewBox en entrée, positions en sortie) : elle
 * se teste sans DOM.
 */
export function placeParetoLabels(points: LabelInput[], frame: LabelFrame): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];

  for (const p of points) {
    const text = p.text.length > LABEL_MAX_CHARS ? `${p.text.slice(0, LABEL_MAX_CHARS - 1)}…` : p.text;
    const w = text.length * LABEL_CHAR_W;
    const off = p.r + 4;
    const candidates: PlacedLabel[] = [
      { text, x: p.x + off, y: p.y - off, anchor: 'start' },
      { text, x: p.x + off, y: p.y + off + LABEL_H, anchor: 'start' },
      { text, x: p.x - off, y: p.y - off, anchor: 'end' },
      { text, x: p.x - off, y: p.y + off + LABEL_H, anchor: 'end' },
    ];
    for (const c of candidates) {
      const x0 = c.anchor === 'start' ? c.x : c.x - w;
      const box = { x0, x1: x0 + w, y0: c.y - LABEL_H, y1: c.y };
      const inside = box.x0 >= frame.left && box.x1 <= frame.right && box.y0 >= frame.top && box.y1 <= frame.bottom;
      if (!inside) continue;
      const hits = boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
      if (hits) continue;
      placed.push(c);
      boxes.push(box);
      break;
    }
  }
  return placed;
}

type View = 'nuage' | 'correlation';

export function FoodExplorer({ foods, jamaisManges }: { foods: Food[]; jamaisManges?: ReadonlySet<string> }) {
  const [view, setView] = useState<View>('nuage');
  const explorable = useMemo(() => foods.filter((f) => f.categorie !== 'supplement'), [foods]);
  const supplements = useMemo(() => foods.filter((f) => f.categorie === 'supplement'), [foods]);
  const neverEaten = useMemo(() => jamaisManges ?? new Set<string>(), [jamaisManges]);
  const nbNonManges = useMemo(
    () => explorable.reduce((n, f) => n + (neverEaten.has(f.id) ? 1 : 0), 0),
    [explorable, neverEaten],
  );

  return (
    <ExplorableCtx.Provider value={explorable}>
      <SupplementsCtx.Provider value={supplements}>
      <NeverEatenCtx.Provider value={neverEaten}>
      <div className="panel">
        <p className="small" style={{ marginTop: 0, marginBottom: 8 }}>
          {explorable.length} aliments · valeurs pour 100 g. Croisez les nutriments, mesurez leurs corrélations,
          comparez les profils. Couleur = catégorie sur toutes les vues.
          {nbNonManges > 0 && (
            <>
              {' '}
              <span style={{ color: C.muted }}>
                Dont {nbNonManges} jamais mangé{nbNonManges > 1 ? 's' : ''}, tracé
                {nbNonManges > 1 ? 's' : ''} en pointillés.
              </span>
            </>
          )}
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
      </NeverEatenCtx.Provider>
      </SupplementsCtx.Provider>
    </ExplorableCtx.Provider>
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
  value: ChartKey | 'none';
  onChange: (k: ChartKey | 'none') => void;
  allowNone?: boolean;
}) {
  return (
    <label className="field" style={{ minWidth: 150 }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as ChartKey | 'none')}>
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
  const neverEaten = useNeverEaten();
  const supplements = useSupplements();
  const [xk, setXk] = useState<ChartKey>('prix');
  const [yk, setYk] = useState<ChartKey>('proteines');
  const [sizeK, setSizeK] = useState<ChartKey | 'none'>('none');
  const [logX, setLogX] = useState(false);
  const [logY, setLogY] = useState(false);
  const [pareto, setPareto] = useState(true);
  const [xGoal, setXGoal] = useState<'min' | 'max'>('min');
  const [yGoal, setYGoal] = useState<'min' | 'max'>('max');
  const [hideCats, setHideCats] = useState<Set<FoodCategory>>(new Set<FoodCategory>(['supplement']));
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const W = 680;
  const H = 460;
  const m = { top: 18, right: 18, bottom: 46, left: 58 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  const explorable = useExplorable();
  const chartFoods = useMemo(
    () => [...explorable, ...supplements],
    [explorable, supplements],
  );
  const searchableFoods = useMemo(() => [...explorable, ...supplements], [explorable, supplements]);
  const normalizedSearch = normalizeForMatch(search);
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
  const pointPressRef = useRef<Map<number, { foodId: string | null; x: number; y: number; moved: boolean; selectedBefore: string | null }>>(new Map());
  const pinchRef = useRef<{ dist: number } | null>(null);

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    const firstPointer = pointersRef.current.size === 0;
    const hitPoint = (e.target as Element).closest<SVGCircleElement>('[data-food-id]');
    let foodId = hitPoint?.dataset.foodId ?? null;
    if (!foodId && firstPointer && svgRef.current) {
      const { x, y } = toViewBox(e, svgRef.current, W, H);
      let closestDistance = Infinity;
      for (const point of points) {
        const distance = Math.hypot(x - cx(point.x), y - cy(point.y));
        const hitRadius = Math.max(radius(point.s) + 10, 16);
        if (distance <= hitRadius && distance < closestDistance) {
          foodId = point.f.id;
          closestDistance = distance;
        }
      }
    }
    const selectedBefore = selectedPointId;
    pointPressRef.current.set(e.pointerId, {
      foodId: firstPointer ? foodId : null,
      x: e.clientX,
      y: e.clientY,
      moved: !firstPointer,
      selectedBefore,
    });
    if (firstPointer && foodId) {
      setSelectedPointId((id) => id === foodId ? null : foodId);
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
    } else {
      for (const press of pointPressRef.current.values()) {
        press.moved = true;
        if (press.foodId) setSelectedPointId(press.selectedBefore);
      }
      dragRef.current = null;
      const pts = [...pointersRef.current.values()];
      pinchRef.current = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
    }
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!pointersRef.current.has(e.pointerId)) return;
    const press = pointPressRef.current.get(e.pointerId);
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
      if (!press.moved && press.foodId) setSelectedPointId(press.selectedBefore);
      press.moved = true;
    }
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
    pointPressRef.current.delete(e.pointerId);
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
    return chartFoods
      .filter((f) => !hideCats.has(f.categorie))
      .map((f) => ({ f, x: val(f, xk), y: val(f, yk), s: sizeK === 'none' ? 0 : val(f, sizeK) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.s) && (p.x > 0 || p.y > 0));
  }, [chartFoods, xk, yk, sizeK, hideCats]);
  const selectedPoint = selectedPointId ? points.find((p) => p.f.id === selectedPointId) ?? null : null;
  const searchCandidates = useMemo(
    () => normalizedSearch ? searchableFoods.filter((f) => normalizeForMatch(f.nom).includes(normalizedSearch)) : [],
    [searchableFoods, normalizedSearch],
  );
  const searchMatches = useMemo(
    () => normalizedSearch ? points.filter((p) => normalizeForMatch(p.f.nom).includes(normalizedSearch)) : [],
    [points, normalizedSearch],
  );
  const searchMatchIds = useMemo(() => new Set(searchMatches.map((p) => p.f.id)), [searchMatches]);

  const frontier = useMemo(
    () => paretoFrontier(points.map((p) => ({ ...p, id: p.f.id })), xGoal, yGoal, xk !== 'prix' && yk !== 'prix'),
    [points, xGoal, yGoal, xk, yk],
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
  const labelFrame = { left: m.left, right: W - m.right, top: m.top, bottom: H - m.bottom };
  const visibleSearchMatches = searchMatches.filter((p) => {
    const x = cx(p.x);
    const y = cy(p.y);
    return x >= labelFrame.left && x <= labelFrame.right && y >= labelFrame.top && y <= labelFrame.bottom;
  });
  const searchLabels = normalizedSearch
    ? placeParetoLabels(
        visibleSearchMatches.map((p) => ({ text: p.f.nom, x: cx(p.x), y: cy(p.y), r: radius(p.s) })),
        labelFrame,
      )
    : [];

  const xTicks = vxs.ticks(logX ? 4 : 6);
  const yTicks = vys.ticks(6);

  const frontierPath = frontier.map((p, i) => `${i === 0 ? 'M' : 'L'} ${cx(p.x)} ${cy(p.y)}`).join(' ');

  const ratioCurvePath = (ratio: number, throughX?: number) => {
    if (!Number.isFinite(ratio) || ratio < 0) return '';
    const plotLeft = logX && hasZeroX ? m.left + ZERO_LANE : m.left;
    const plotRight = W - m.right;
    const sampleXs = Array.from({ length: 81 }, (_, i) => plotLeft + (plotRight - plotLeft) * i / 80);
    if (throughX != null && Number.isFinite(throughX)) {
      const selectedPx = cx(throughX);
      if (selectedPx >= plotLeft && selectedPx <= plotRight) sampleXs.push(selectedPx);
    }
    sampleXs.sort((a, b) => a - b);

    let path = '';
    let segmentStarted = false;
    for (const px of sampleXs) {
      const x = vxs.invert(px);
      const y = ratio * x;
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || (logX && x <= 0) || (logY && y < 0)) {
        segmentStarted = false;
        continue;
      }
      path += `${segmentStarted ? 'L' : 'M'} ${cx(x)} ${cy(y)} `;
      segmentStarted = true;
    }
    return path.trim();
  };
  const oneToOnePath = ratioCurvePath(1);
  const selectedRatio = selectedPoint && selectedPoint.x > 0 ? selectedPoint.y / selectedPoint.x : null;
  const selectedRatioPath = selectedRatio != null
    ? ratioCurvePath(selectedRatio, selectedPoint?.x)
    : selectedPoint && selectedPoint.x === 0 && selectedPoint.y > 0
      ? `M ${cx(0)} ${m.top} L ${cx(0)} ${H - m.bottom}`
      : '';

  // Noms des aliments de la frontière. Recalculés à chaque rendu parce qu'ils
  // suivent le zoom et le déplacement du nuage.
  const frontierLabels = pareto
    ? placeParetoLabels(
        frontier
          .filter((p) => !visibleSearchMatches.some((match) => match.f.id === p.f.id))
          .map((p) => ({ text: p.f.nom, x: cx(p.x), y: cy(p.y), r: radius(p.s) })),
        labelFrame,
      )
    : [];

  return (
    <>
      <div className="panel">
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <NutSelect label="Axe X" value={xk} onChange={(k) => setXk(k as ChartKey)} />
          <NutSelect label="Axe Y" value={yk} onChange={(k) => setYk(k as ChartKey)} />
          <NutSelect label="Taille des bulles" value={sizeK} onChange={setSizeK} allowNone />
        </div>
        {(tx || ty) && <div className="row small" style={{ gap: 14, marginTop: 8 }}>
          <span><i className="ref-legend ajr" /> AJR (100 g qui couvre le besoin du jour)</span>
          <span><i className="ref-legend opti" /> Optimal (cible perf/santé)</span>
        </div>}
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
      </div>

      <div className="panel">
        {/*
          Légende ET filtre, collés au graphe : la légende vivait dans un panneau
          séparé ~150 px plus bas, ce qui obligeait l'œil à faire l'aller-retour à
          chaque point. Le bouton porte la marque exacte du nuage (forme +
          couleur), donc il légende ce qu'il filtre.
        */}
        <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '1 1 240px', maxWidth: 380 }}>
            Rechercher un aliment
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ex. L2 poulet"
              aria-label="Rechercher un aliment dans le nuage"
            />
          </label>
          {normalizedSearch && (
            <>
              <span className="small" style={{ paddingBottom: 8 }} aria-live="polite">
                {searchMatches.length === 0
                  ? searchCandidates.length === 0
                    ? 'Aucun aliment trouvé.'
                    : searchCandidates.every((f) => f.categorie === 'supplement') && hideCats.has('supplement')
                      ? `${searchCandidates.length} supplément${searchCandidates.length > 1 ? 's' : ''} trouvé${searchCandidates.length > 1 ? 's' : ''} · activez la catégorie « Suppléments » pour ${searchCandidates.length > 1 ? 'les' : 'le'} tracer.`
                      : `${searchCandidates.length} résultat${searchCandidates.length > 1 ? 's' : ''} trouvé${searchCandidates.length > 1 ? 's' : ''}, mais pas traçable${searchCandidates.length > 1 ? 's' : ''} avec les axes ou filtres actuels.`
                  : `${searchMatches.length} résultat${searchMatches.length > 1 ? 's' : ''} · ${visibleSearchMatches.length} dans la zone affichée`}
              </span>
              <button className="ghost small" onClick={() => setSearch('')}>Effacer</button>
            </>
          )}
        </div>
        <div className="row cat-legend" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {CATS.map((c) => (
            <button
              key={c.key}
              className="ghost small cat-btn"
              style={{ opacity: hideCats.has(c.key) ? 0.4 : 1, borderColor: hideCats.has(c.key) ? C.border : c.color }}
              data-tip={hideCats.has(c.key) ? 'Afficher cette catégorie' : 'Masquer cette catégorie'}
              onClick={() =>
                setHideCats((s) => {
                  const n = new Set(s);
                  n.has(c.key) ? n.delete(c.key) : n.add(c.key);
                  return n;
                })
              }
            >
              <CatIcon cat={c.key} />
              {c.key === 'supplement' ? `${c.label} (${supplements.length})` : c.label}
            </button>
          ))}
          {points.some((p) => neverEaten.has(p.f.id)) && (
            <span className="row small" style={{ gap: 5, alignItems: 'center', color: C.muted }}>
              <svg width={14} height={14} aria-hidden>
                <circle cx={7} cy={7} r={5} fill={C.muted} fillOpacity={0.35} stroke={C.muted} strokeWidth={1.5} strokeDasharray="3 2" />
              </svg>
              Jamais mangé (catalogue)
            </span>
          )}
        </div>
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
              <path d={oneToOnePath} fill="none" stroke={C.muted} strokeWidth={1.5} strokeDasharray="2 4" opacity={0.7} />
              {selectedRatioPath && (
                <path d={selectedRatioPath} fill="none" stroke={C.accent} strokeWidth={2.5} strokeDasharray="1 5" strokeLinecap="round" opacity={0.95} />
              )}
              {pareto && frontier.length > 1 && (
                <path d={frontierPath} fill="none" stroke={C.accent2} strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />
              )}
              {points.map((p, i) => {
                const onFront = pareto && frontierSet.has(p.f.id);
                const isHover = hover?.i === i;
                const isSearchMatch = searchMatchIds.has(p.f.id);
                const isSelected = selectedPointId === p.f.id;
                const jamais = neverEaten.has(p.f.id);
                const r = radius(p.s);
                // Zone de tap agrandie et invisible : sur mobile, les bulles réelles (souvent
                // 3-8 px) sont trop petites pour viser précisément au doigt. Le survol (souris)
                // continue de fonctionner sur cette même zone.
                const hitR = Math.max(r + 10, 16);
                return (
                  <g key={p.f.id}>
                    {isSearchMatch && (
                      <path
                        transform={`translate(${cx(p.x)} ${cy(p.y)})`}
                        d={catSymbolPath(p.f.categorie, r + 3.5)}
                        fill={C.text}
                        fillOpacity={0.2}
                        stroke={C.text}
                        strokeWidth={1.5}
                        style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.9))' }}
                        pointerEvents="none"
                      />
                    )}
                    <path
                      transform={`translate(${cx(p.x)} ${cy(p.y)})`}
                      d={catSymbolPath(p.f.categorie, r * (isHover ? 1.35 : 1))}
                      fill={COLOR_BY_CAT.get(p.f.categorie)}
                      // Jamais mangé : rempli plus clair et cerclé de pointillés. Le
                      // contour reste celui de Pareto quand le point est sur la
                      // frontière — c'est justement là qu'il faut voir d'un coup d'œil
                      // si le meilleur compromis est un aliment habituel ou une piste.
                      fillOpacity={jamais ? 0.34 : onFront ? 0.95 : 0.72}
                      stroke={isSearchMatch || isSelected ? C.text : onFront ? C.accent2 : isHover ? C.text : jamais ? C.muted : 'none'}
                      strokeWidth={isSearchMatch || isSelected ? 2.5 : onFront ? 2 : isHover ? 1.5 : jamais ? 1.5 : 0}
                      strokeDasharray={jamais ? '3 2' : undefined}
                      pointerEvents="none"
                    />
                    <circle
                      cx={cx(p.x)}
                      cy={cy(p.y)}
                      r={hitR}
                      fill="transparent"
                      data-food-id={p.f.id}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => {
                        if (svgRef.current) {
                          const v = toViewBox(e, svgRef.current, W, H);
                          setHover({ i, px: v.px, py: v.py });
                        }
                      }}
                    />
                  </g>
                );
              })}

              {/*
                Halo de fond (paint-order) : sans lui, un nom posé sur une zone
                dense de points devient illisible. Masqué au téléphone par CSS —
                le SVG est en viewBox, donc à 390 px de large ces 10 px de police
                n'en font plus que 6 à l'écran.
              */}
              <g className="pareto-labels" pointerEvents="none">
                {frontierLabels.map((l) => (
                  <text
                    key={`${l.text}-${Math.round(l.x)}-${Math.round(l.y)}`}
                    x={l.x}
                    y={l.y}
                    textAnchor={l.anchor}
                    fontSize={10}
                    fill={C.text}
                    stroke={C.panel}
                    strokeWidth={3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                  >
                    {l.text}
                  </text>
                ))}
              </g>
              <g className="scatter-search-labels" pointerEvents="none">
                {searchLabels.map((l) => (
                  <text
                    key={`${l.text}-${Math.round(l.x)}-${Math.round(l.y)}`}
                    x={l.x}
                    y={l.y}
                    textAnchor={l.anchor}
                    fontSize={10}
                    fontWeight={700}
                    fill={C.text}
                    stroke={C.panel}
                    strokeWidth={3.5}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                  >
                    {l.text}
                  </text>
                ))}
              </g>
            </g>
          </svg>

          {hover && (() => {
            const p = points[hover.i];
            const portionG = portionGrams(p.f);
            const factor = portionG / 100;
            // % AJR / optimal pour la portion réaliste de l'aliment (pas les 100 g
            // de l'axe) : c'est ce qu'on mange vraiment qui répond à « ça rapporte
            // beaucoup ou non », d'où un calcul distinct des repères de l'échelle.
            const detail = (k: ChartKey, per100: number) => {
              if (k === 'prix') return null;
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
                {neverEaten.has(p.f.id) && <span style={{ color: C.muted }}> · jamais mangé</span>}
                <br />
                {NUT_LABEL.get(xk)} : {pointValue(xk, p.x)}
                <br />
                {NUT_LABEL.get(yk)} : {pointValue(yk, p.y)}
                {sizeK !== 'none' && (
                  <>
                    <br />
                    {NUT_LABEL.get(sizeK)} : {pointValue(sizeK, p.s)}
                  </>
                )}
                <br />
                <span style={{ color: C.muted }}>Portion ≈ {fmt(portionG)} g</span>
                {p.f.price && <><br /><span style={{ color: C.muted }}>Prix estimé · confiance {p.f.price.confidence} · {p.f.price.date}</span></>}
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
            {NUT_LABEL.get(xk)} ({xGoal === 'max' ? 'plus' : 'moins'}){xk === 'prix' || yk === 'prix' ? '' : ', plus ceux déjà à la valeur limite sur un axe'}. Ce sont eux
            qui portent un nom sur le graphe
            {frontierLabels.length < frontier.length &&
              ` (${frontier.length - frontierLabels.length} sur ${frontier.length} restent anonymes, faute de place : zoomez pour les lire)`}
            {' '}— au téléphone, l'écran est trop étroit pour les afficher, le nom reste au toucher. Les repères clairs
            indiquent les AJR et les verts la cible optimale (100 g qui couvrent le besoin du jour, selon votre profil).
          </p>
        )}
        <p className="small" style={{ marginTop: pareto ? 8 : 0, marginBottom: 0 }}>
          Pointillés gris : rapport 1:1. {selectedPoint
            ? selectedPoint.x === 0 && selectedPoint.y === 0
              ? <>Le rapport X/Y de <strong>{selectedPoint.f.nom}</strong> est indéfini, ses deux valeurs sont nulles.</>
              : <>Courbe bleue : même rapport X/Y que <strong>{selectedPoint.f.nom}</strong>. Cliquez à nouveau sur ce point pour retirer la courbe.</>
            : 'Cliquez sur un point pour garder sa courbe de rapport X/Y affichée.'}
        </p>
      </div>
    </>
  );
}

// ===========================================================================
// Vue 2 — Matrice de corrélation (Pearson) entre nutriments
// ===========================================================================

/** Pearson sur les seules paires renseignées ; une série constante n'est pas une corrélation nulle. */
export function pearson(a: number[], b: number[]): { r: number | null; n: number } {
  const pairs = a.map((value, i) => [value, b[i]] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 3) return { r: null, n: pairs.length };
  const ma = d3mean(pairs, (pair) => pair[0]) ?? 0;
  const mb = d3mean(pairs, (pair) => pair[1]) ?? 0;
  let num = 0;
  let da = 0;
  let db = 0;
  for (const [x, y] of pairs) {
    const xa = x - ma;
    const xb = y - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return { r: den === 0 ? null : num / den, n: pairs.length };
}

/** Couleur divergente rouge (−1) → neutre (0) → bleu (+1). */
function corrColor(r: number | null): string {
  if (r === null) return C.border;
  const neg = [239, 93, 93]; // danger
  const pos = [91, 140, 255]; // accent
  const neutral = [31, 35, 44]; // panel2
  const t = Math.abs(r);
  const target = r >= 0 ? pos : neg;
  const mix = neutral.map((c, i) => Math.round(c + (target[i] - c) * t));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

function CorrelationView() {
  const MACRO_KEYS: ChartKey[] = ['prix', 'kcal', 'proteines', 'glucides', 'lipides', 'fibres', 'agSatures', 'agTrans', 'agMonoInsatures', 'agPolyInsatures', 'omega3', 'omega6', 'omega9'];
  const DEFAULT_KEYS: ChartKey[] = ['prix', 'kcal', 'proteines', 'glucides', 'lipides'];
  const [keys, setKeys] = useState<ChartKey[]>(DEFAULT_KEYS);
  const [pickerOpen, setPickerOpen] = useState(false);

  const explorable = useExplorable();

  const cols = useMemo(() => keys.map((k) => explorable.map((f) => val(f, k))), [explorable, keys.join(',')]);
  const matrix = useMemo(
    () => keys.map((_, i) => keys.map((_, j) => pearson(cols[i], cols[j]))),
    [cols],
  );

  const n = keys.length;
  const cell = n <= 8 ? 34 : n <= 18 ? 28 : 24;
  const labelW = 112;
  const labelTop = 84;
  const W = labelW + n * cell + 6;
  const H = labelTop + n * cell + 6;

  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  const toggle = (key: ChartKey) => setKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
  const shortLabel = (key: ChartKey) => {
    const label = NUT_LABEL.get(key) ?? key;
    return label.replace('Vitamine ', 'Vit. ').replace('AG poly-insaturés', 'AG polyins.').replace('AG mono-insaturés', 'AG monoins.');
  };

  return (
    <div className="panel">
      <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="ghost small" onClick={() => setKeys(DEFAULT_KEYS)}>Prix + macros</button>
        <button className="ghost small" onClick={() => setKeys(MACRO_KEYS)}>Macros élargies</button>
        <button className="ghost small" onClick={() => setKeys(NUT.map((item) => item.key))}>Tout</button>
      </div>
      <div style={{ marginBottom: 12 }}>
        <button className="ghost small" aria-expanded={pickerOpen} onClick={() => setPickerOpen((open) => !open)}>
          ⚙ Personnaliser les variables ({keys.length}) {pickerOpen ? '▴' : '▾'}
        </button>
        {pickerOpen &&
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 12, marginTop: 10, padding: 10, border: `1px solid ${C.border}`, borderRadius: 8 }}>
          {[{ title: 'Prix', keys: ['prix'] as ChartKey[] }, ...NUTRIENT_GROUPS.map((group) => ({ ...group, keys: group.keys.filter((key) => NUT_LABEL.has(key)) }))].map((group) => (
            <div key={group.title}>
              <strong className="small" style={{ display: 'block', marginBottom: 5 }}>{group.title}</strong>
              <div style={{ display: 'grid', gap: 3 }}>
                {group.keys.map((key) => <label key={key} className="small" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={keys.includes(key)} onChange={() => toggle(key)} /> {NUT_LABEL.get(key)}
                </label>)}
              </div>
            </div>
          ))}
        </div>}
      </div>
      <p className="small" style={{ marginTop: 0 }}>
        Corrélation de Pearson entre variables sur les {explorable.length} aliments (nutriments pour 100 g, prix en €/kg).
        Chaque paire utilise uniquement les aliments renseignés ; une case grise est non calculable.
        <span style={{ color: C.accent }}> Bleu</span> = varient ensemble,
        <span style={{ color: C.danger }}> rouge</span> = varient à l'inverse, sombre ≈ indépendants.
      </p>

      {keys.length < 2 ? <div className="empty">Choisissez au moins deux variables.</div> : <div style={{ overflow: 'auto', maxHeight: 'min(68vh, 620px)', maxWidth: '100%', display: 'flex', justifyContent: n <= 8 ? 'center' : undefined }}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', maxWidth: n <= 5 ? '100%' : undefined }} aria-label={`Matrice de corrélation de ${n} variables`}>
          {/* étiquettes colonnes (haut, pivotées) */}
          {keys.map((k, j) => (
            <text
              key={`c${k}`}
              transform={`translate(${labelW + j * cell + cell / 2} ${labelTop - 6}) rotate(-55)`}
              fill={hover?.j === j || hover?.i === j ? C.text : C.muted}
              fontSize={n <= 12 ? 10 : 9}
              textAnchor="start"
            >
              {shortLabel(k)}
            </text>
          ))}
          {/* étiquettes lignes (gauche) */}
          {keys.map((k, i) => (
            <text
              key={`r${k}`}
              x={labelW - 6}
              y={labelTop + i * cell + cell / 2}
              fill={hover?.i === i || hover?.j === i ? C.text : C.muted}
              fontSize={n <= 12 ? 10 : 9}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {shortLabel(k)}
            </text>
          ))}
          {/* cellules */}
          {matrix.map((row, i) =>
            row.map(({ r }, j) => (
              <g key={`${i}-${j}`}>
                <rect
                  x={labelW + j * cell}
                  y={labelTop + i * cell}
                  width={cell - 1.5}
                  height={cell - 1.5}
                  rx={2}
                  fill={i === j ? C.panel2 : j > i ? 'transparent' : corrColor(r)}
                  stroke={hover?.i === i && hover?.j === j ? C.text : 'none'}
                  strokeWidth={1.5}
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHover({ i, j })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover({ i, j })}
                />
                {j < i && r !== null && (n <= 8 || Math.abs(r) >= 0.55) && (
                  <text
                    x={labelW + j * cell + (cell - 1.5) / 2}
                    y={labelTop + i * cell + (cell - 1.5) / 2}
                    fill={Math.abs(r) > 0.4 ? '#fff' : C.muted}
                    fontSize={n <= 12 ? 10 : 8}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                  >
                    {r.toFixed(n <= 12 ? 2 : 1)}
                  </text>
                )}
              </g>
            )),
          )}
        </svg>
      </div>}

      {hover && (
        <div className="small" style={{ marginTop: 10, color: C.text }}>
          <strong>{NUT_LABEL.get(keys[hover.i])}</strong> × <strong>{NUT_LABEL.get(keys[hover.j])}</strong> :{' '}
          {matrix[hover.i]?.[hover.j]?.r == null ? 'non calculable' : <>
            <span className="mono" style={{ color: Math.abs(matrix[hover.i][hover.j].r!) < 0.2 ? C.muted : matrix[hover.i][hover.j].r! >= 0 ? C.accent : C.danger }}>
              r = {matrix[hover.i][hover.j].r!.toFixed(2)}
            </span>{' '}{corrLabel(matrix[hover.i][hover.j].r!)}
          </>}
          {' · '}n = {matrix[hover.i]?.[hover.j]?.n ?? 0}
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

