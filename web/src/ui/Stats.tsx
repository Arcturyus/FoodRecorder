import { useMemo, useRef, useState } from 'react';
import { scaleLinear, scaleLog } from 'd3-scale';
import { line as d3line, arc as d3arc, pie as d3pie } from 'd3-shape';
import { max as d3max } from 'd3-array';
import type { Target } from '../nutrition/targets';
import { RATIOS, computeRatio } from '../nutrition/ratios';
import type { NutrientKey, Nutrients } from '../nutrition/types';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { NUTRIENT_GROUPS } from '../nutrition/groups';
import { Omega3Breakdown } from './Totals';
import {
  PeriodSelector,
  GranularitySelector,
  HalfLifeSelector,
  groupDates,
  granularityUnit,
} from './PeriodSelector';
import type { Granularity } from './PeriodSelector';
import { decayWeight, decayWindowDays } from '../nutrition/recommend';
import { usePeriodNutrition } from './usePeriodNutrition';
import { fmt } from './format';

/** Toutes les clés de nutriments (moyennes par groupe de dates). */
const NUT_KEYS = Object.keys(EMPTY_NUTRIENTS) as NutrientKey[];

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

/** Fenêtres proposées pour la moyenne mobile (en jours). */
const MA_WINDOWS = [3, 7, 14, 30];

/**
 * Moyenne mobile glissante (trailing) sur `window` points, en ignorant les trous
 * (jours sans donnée = null) : chaque point moyenne les valeurs définies des
 * `window` derniers jours enregistrés. Renvoie null si aucune valeur dans la fenêtre.
 */
export function movingAverage(values: (number | null)[], window: number): (number | null)[] {
  return values.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = values[j];
      if (v != null) {
        sum += v;
        n++;
      }
    }
    return n > 0 ? sum / n : null;
  });
}

/**
 * Moyenne DÉGRESSIVE glissante : chaque point moyenne les pas de temps qui le
 * précèdent, pondérés par ½ à chaque demi-vie — la valeur affichée un jour donné
 * répond donc à « où j'en étais ces derniers jours, le récent comptant plus »,
 * là où la moyenne mobile met tous les jours de sa fenêtre sur le même plan.
 *
 * La profondeur est celle de `decayWindowDays` (au-delà, un pas pèserait moins
 * de 10 %) : le lissage des courbes et les conseils pondérés d'une même demi-vie
 * regardent ainsi exactement les mêmes jours. Les trous sont ignorés (jamais
 * comptés comme des zéros), et un point sans aucun antécédent reste null.
 */
export function decayAverage(values: (number | null)[], halfLife: number): (number | null)[] {
  const depth = decayWindowDays(halfLife);
  return values.map((_, i) => {
    let num = 0;
    let den = 0;
    for (let j = Math.max(0, i - depth); j <= i; j++) {
      const v = values[j];
      if (v == null) continue;
      const w = decayWeight(i - j, halfLife);
      num += v * w;
      den += w;
    }
    return den > 0 ? num / den : null;
  });
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
  // Chaîne « période → moyennes » partagée avec l'onglet Nutriments (état propre à Stats).
  const {
    period,
    setPeriod,
    includeToday,
    setIncludeToday,
    excludeSupplements,
    setExcludeSupplements,
    decayOn,
    setDecayOn,
    halfLife,
    setHalfLife,
    targets,
    targetByKey,
    byDateVitD,
    days,
    windowDates,
    recorded,
    averages,
  } = usePeriodNutrition();

  // Sélection unifiée : ids de nutriments (NutrientKey) ET de rapports (clé RatioDef,
  // sans collision avec les nutriments). Une seule tendance, une seule moyenne mobile.
  const [selected, setSelected] = useState<string[]>(['kcal', 'proteines']);
  const [maOn, setMaOn] = useState(false);
  const [maWindow, setMaWindow] = useState(7);
  /**
   * Pas de temps de la tendance : un point par jour, par semaine ou par mois.
   * Sur 90 jours ou un an, la courbe journalière n'est plus lisible — agréger
   * en moyennes hebdomadaires/mensuelles montre le fond du mouvement.
   */
  const [gran, setGran] = useState<Granularity>('jour');
  /**
   * Échelle Y logarithmique : les séries étant exprimées en % de cible, elles
   * peuvent couvrir plusieurs ordres de grandeur (ex. vitamine D à 10 % vs
   * sodium à 300 %). Le log rend leurs variations relatives comparables.
   */
  const [logY, setLogY] = useState(false);
  /**
   * Référence utilisée comme « 100 % » dans toute la page (courbes ET barres de
   * couverture), pour les nutriments à COUVRIR (goal `atLeast`) : `optimal`
   * (défaut, cible santé/sport) ou `ajr` (juste couvrir le besoin de référence).
   * Les nutriments « à limiter » gardent toujours l'AJR (plafond) comme 100 % —
   * ce réglage n'a de sens que dans un sens (viser haut), pas dans l'autre.
   */
  const [refMode, setRefMode] = useState<'optimal' | 'ajr'>('optimal');

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /**
   * Lissage des courbes : moyenne mobile classique, ou moyenne dégressive dès
   * que la pondération globale est active — les courbes disent alors la même
   * chose que les moyennes et les conseils, avec la même demi-vie.
   */
  const smooth = useMemo(
    () => (raws: (number | null)[]) => (decayOn ? decayAverage(raws, halfLife) : movingAverage(raws, maWindow)),
    [decayOn, halfLife, maWindow],
  );
  /** La courbe lissée s'affiche d'office quand la pondération est active. */
  const smoothOn = decayOn || maOn;

  /**
   * Points de l'axe temps : un par jour enregistré, ou un par semaine/mois selon
   * la granularité choisie.
   */
  const buckets = useMemo(() => groupDates(recorded, gran), [recorded, gran]);

  /**
   * Apports MOYENS PAR JOUR de chaque groupe de dates : en granularité « jour »
   * c'est le total du jour lui-même, sinon la moyenne journalière de la semaine
   * ou du mois. Toutes les cibles étant journalières, agréger en moyenne (et non
   * en somme) garde les « % de la cible » comparables d'une granularité à l'autre.
   */
  const bucketAverages = useMemo(
    () =>
      buckets.map((b) => {
        if (b.dates.length === 1) return byDateVitD.get(b.dates[0])!;
        const a = { ...EMPTY_NUTRIENTS };
        for (const d of b.dates) {
          const t = byDateVitD.get(d)!;
          for (const k of NUT_KEYS) a[k] += t[k];
        }
        for (const k of NUT_KEYS) a[k] /= b.dates.length;
        return a;
      }),
    [buckets, byDateVitD],
  );

  /**
   * Séries de la tendance unique : un tracé par élément sélectionné (nutriment OU
   * rapport), tout exprimé en % de sa cible pour être comparable sur un seul axe.
   * Chaque point porte le % brut et, si activée, le % lissé (moyenne mobile).
   */
  const series = useMemo<TrendSeries[]>(
    () =>
      selected.map((id, i) => {
        const color = SERIES_COLORS[i % SERIES_COLORS.length];
        const ratioDef = RATIOS.find((r) => r.key === id);
        const point = (k: number, value: number | null, pct: number | null, maPct: number | null) => ({
          date: buckets[k].date,
          label: buckets[k].label,
          t: dayMs(buckets[k].date),
          value,
          pct,
          maPct,
        });

        if (ratioDef) {
          // Rapport : calculé SUR les apports moyens du groupe (pas la moyenne des
          // rapports quotidiens), pour qu'un jour extrême ne domine pas la semaine.
          const objective = ratioDef.optimal;
          const values = bucketAverages.map((a) => computeRatio(ratioDef, a).value);
          const raws = values.map((v) => (v == null ? null : (v / objective) * 100));
          const ma = smooth(raws);
          return {
            id,
            kind: 'ratio' as const,
            label: ratioDef.label,
            suffix: ratioDef.suffix,
            color,
            objective,
            points: values.map((v, k) => point(k, v, raws[k], ma[k])),
          };
        }

        // Nutriment : % = apport / objectif (plafond pour les « limites », sinon
        // optimal ou AJR selon `refMode`).
        const t = targetByKey.get(id as NutrientKey)!;
        const objective = t.goal === 'limit' ? t.ajr : refMode === 'ajr' ? t.ajr : t.optimal;
        const values = bucketAverages.map((a) => a[id as NutrientKey]);
        const raws = values.map((v) => (objective > 0 ? (v / objective) * 100 : 0));
        const ma = smooth(raws);
        return {
          id,
          kind: 'nutrient' as const,
          label: t.label,
          unit: t.unit,
          goal: t.goal,
          color,
          objective,
          points: values.map((v, k) => point(k, v, raws[k], ma[k])),
        };
      }),
    [selected, targetByKey, buckets, bucketAverages, smooth, refMode],
  );

  const colorById = useMemo(() => new Map(series.map((s) => [s.id, s.color])), [series]);

  return (
    <>
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Analyse sur {days} jours</h2>
          <PeriodSelector value={period} onChange={setPeriod} />
        </div>
        <div className="row" style={{ alignItems: 'center', marginTop: 4, gap: 16, flexWrap: 'wrap' }}>
          <label
            className="row small"
            style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
            data-tip="Par défaut, la journée en cours (pas encore terminée) est exclue de toutes les moyennes ci-dessous, pour ne pas les tirer artificiellement vers le bas."
          >
            <input type="checkbox" checked={includeToday} onChange={(e) => setIncludeToday(e.target.checked)} />
            Inclure la journée en cours dans les moyennes
          </label>
          <label
            className="row small"
            style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
            data-tip="Retire créatine, whey, magnésium, vitamines, oméga 3… mais aussi le sel et le poivre (même catégorie) de toutes les analyses ci-dessous. Le gain de vitamine D du soleil, lui, est conservé."
          >
            <input
              type="checkbox"
              checked={excludeSupplements}
              onChange={(e) => setExcludeSupplements(e.target.checked)}
            />
            Sans les suppléments
          </label>
          <label
            className="row small"
            style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
            data-tip="Les jours récents pèsent plus que les anciens dans TOUT l'écran : courbes lissées, couverture moyenne, répartition des macros. Répond à « où j'en suis en ce moment » plutôt qu'à « quelle a été ma moyenne sur la période »."
          >
            <input type="checkbox" checked={decayOn} onChange={(e) => setDecayOn(e.target.checked)} />
            Pondération dégressive
          </label>
          <HalfLifeSelector
            value={halfLife}
            onChange={setHalfLife}
            tip={`Vitesse à laquelle un jour perd son influence : à ${halfLife} j d'écart il compte moitié moins, et au-delà de ${decayWindowDays(halfLife)} jours il ne pèse plus rien. Sert à la pondération dégressive de cet écran.`}
          />
          <span
            className="row small"
            style={{ gap: 4, alignItems: 'center' }}
            data-tip="Quelle cible vaut 100 % dans les courbes et les barres de couverture ci-dessous, pour les nutriments à couvrir : « Optimal » (cible santé/sport, par défaut) ou « AJR » (juste le besoin de référence). Les nutriments à limiter gardent toujours leur plafond (AJR) comme 100 %."
          >
            <span style={{ color: 'var(--muted)' }}>Référence 100 %</span>
            <button className={`small ${refMode === 'optimal' ? 'chip-active' : 'ghost'}`} onClick={() => setRefMode('optimal')}>
              Optimal
            </button>
            <button className={`small ${refMode === 'ajr' ? 'chip-active' : 'ghost'}`} onClick={() => setRefMode('ajr')}>
              AJR
            </button>
          </span>
        </div>
        <div className="hint">
          {recorded.length} jour(s) enregistré(s) sur cette période ({days} j
          {!includeToday && ", aujourd'hui exclu"}) — tout est recalculé sur la période.
          {decayOn && (
            <>
              {' '}
              <strong>Pondération dégressive</strong> (demi-vie {halfLife} j) : partout ci-dessous, le jour le plus
              récent compte 1 et chaque tranche de {halfLife} j vers le passé divise le poids par deux. Les moyennes
              restent journalières — donc comparables aux mêmes cibles — mais reflètent votre situation récente.
            </>
          )}
          {excludeSupplements && (
            <>
              {' '}
              <strong>Suppléments exclus</strong> : les courbes, moyennes et couvertures ci-dessous montrent ce que
              votre <em>alimentation seule</em> apporte — utile pour voir quels compléments comblent un vrai manque.
              La catégorie « Compléments &amp; assaisonnements » inclut le sel et le poivre, également retirés (le
              sodium chute donc fortement). Les aliments estimés par l'IA, sans aliment de la base associé, restent
              comptés.
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>Tendance comparée</h2>
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label
              className="row small"
              style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
              data-tip="Axe des % en échelle logarithmique : compare mieux des séries d'ordres de grandeur très différents (ne peut pas représenter 0)."
            >
              <input type="checkbox" checked={logY} onChange={(e) => setLogY(e.target.checked)} />
              Échelle log (Y)
            </label>
            <GranularitySelector
              value={gran}
              onChange={setGran}
              tip="Un point par jour, ou une moyenne journalière par semaine / par mois — plus lisible sur les longues périodes."
            />
            {decayOn ? (
              // La pondération globale pilote déjà le lissage : deux réglages
              // concurrents (fenêtre plate + demi-vie) ne feraient qu'embrouiller.
              <span
                className="small"
                style={{ color: 'var(--muted)' }}
                data-tip={`Chaque point moyenne les ${granularityUnit(gran) === 'j' ? 'jours' : 'pas de temps'} qui le précèdent, le plus récent comptant le plus (demi-vie ${halfLife} ${granularityUnit(gran)}). Décochez « Pondération dégressive » pour revenir à la moyenne mobile.`}
              >
                Lissage : moyenne pondérée ({halfLife} {granularityUnit(gran)})
              </span>
            ) : (
              <>
                <label className="row small" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                  <input type="checkbox" checked={maOn} onChange={(e) => setMaOn(e.target.checked)} />
                  Moyenne mobile
                </label>
                <select
                  value={maWindow}
                  onChange={(e) => setMaWindow(Number(e.target.value))}
                  disabled={!maOn}
                  style={{ opacity: maOn ? 1 : 0.5 }}
                  aria-label="Fenêtre de la moyenne mobile"
                >
                  {MA_WINDOWS.map((w) => (
                    <option key={w} value={w}>
                      {w} {granularityUnit(gran)}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>
        <p className="small" style={{ marginTop: 2 }}>
          Chaque courbe = un élément (nutriment <em>ou</em> rapport) en <strong>% de sa cible</strong> (ligne 100 %),
          pour comparer sur un seul axe. Survolez pour les valeurs réelles.
          {gran !== 'jour' &&
            ` Un point = ${gran === 'semaine' ? 'une semaine' : 'un mois'} (${buckets.length} au total), en moyenne PAR JOUR des jours enregistrés — comparable à la cible journalière.`}
          {selected.includes('vitD') && ' La vitamine D inclut l\'apport du soleil ☀️.'}
          {refMode === 'ajr' && " Nutriments à couvrir : la ligne 100 % est l'AJR (réglage « Référence 100 % » ci-dessus). Les rapports gardent leur propre cible."}
          {decayOn
            ? ` Chaque point de la courbe épaisse est la moyenne pondérée des ${decayWindowDays(halfLife)} ${granularityUnit(gran)} qui le précèdent (demi-vie ${halfLife} ${granularityUnit(gran)}) : une carence comblée depuis s'efface, une carence installée reste. La courbe brute reste en trait fin.`
            : maOn && ' La moyenne mobile lisse le bruit ; la courbe brute reste en trait fin.'}
          {logY && ' Axe log : les valeurs à 0 % (aucun apport) ne sont pas représentables et laissent un trou.'}
        </p>
        <MultiTrend
          series={series}
          windowDates={windowDates}
          maOn={smoothOn}
          maWindow={decayOn ? halfLife : maWindow}
          maLabel={decayOn ? 'moy. pondérée' : 'moy. mobile'}
          maUnit={granularityUnit(gran)}
          logY={logY}
        />
        <SeriesPicker targets={targets} selected={selected} colorById={colorById} onToggle={toggle} />
      </div>

      <div className="panel">
        <h2>Couverture moyenne vs objectifs{decayOn && ' (pondérée)'}</h2>
        <p className="small" style={{ marginTop: -6 }}>
          Barres triées du moins couvert au mieux couvert (moyenne/jour sur la période
          {decayOn && `, pondérée : demi-vie ${halfLife} j`}).{' '}
          <span className="ref-legend ajr" /> AJR{refMode === 'ajr' ? ' (100 %)' : ''} ·{' '}
          <span className="ref-legend opti" /> objectif optimal{refMode === 'optimal' ? ' (100 %)' : ''}.
          {refMode === 'ajr' && " Pour les nutriments « à limiter » ci-dessous, le plafond (AJR) reste la référence 100 % quel que soit ce réglage."}{' '}
          Cliquez un nutriment pour l'ajouter à la tendance. La vitamine D inclut l'apport du soleil ☀️.
        </p>
        <CoverageList averages={averages} targets={targets} selected={selected} onToggle={toggle} refMode={refMode} />
      </div>

      <div className="panel">
        <h2>Répartition des calories (macros, moyenne/jour{decayOn && ' pondérée'})</h2>
        <MacroDonut totals={averages} />
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

/**
 * Série de la tendance unifiée. `pct` = % de la cible (comparable entre unités) ;
 * `maPct` = idem lissé par moyenne mobile. `value` = valeur réelle (apport ou
 * rapport) pour l'info-bulle (null les jours sans donnée, cas des rapports).
 */
type TrendSeries = {
  id: string;
  kind: 'nutrient' | 'ratio';
  label: string;
  color: string;
  objective: number;
  unit?: string; // nutriment
  goal?: Target['goal']; // nutriment
  suffix?: string; // rapport (ex. « :1 »)
  /** Un point par pas de temps : `date` situe le point sur l'axe, `label` le nomme. */
  points: {
    date: string;
    label: string;
    t: number;
    value: number | null;
    pct: number | null;
    maPct: number | null;
  }[];
};

/** Formate une valeur de rapport (« 3,2:1 »). */
function fmtRatio(v: number, suffix: string): string {
  return `${fmt(v, v < 10 ? 1 : 0)}${suffix}`;
}

/** Valeur réelle d'un point selon le type de série (apport ou rapport formaté). */
function formatSeriesValue(s: TrendSeries, value: number): string {
  return s.kind === 'ratio' ? fmtRatio(value, s.suffix ?? '') : `${fmtVal(value)} ${s.unit ?? ''}`.trim();
}

function MultiTrend({
  series,
  windowDates,
  maOn,
  maWindow,
  maLabel,
  maUnit,
  logY,
}: {
  series: TrendSeries[];
  windowDates: string[];
  maOn: boolean;
  maWindow: number;
  /** Nom du lissage dans l'info-bulle (« moy. mobile » ou « moy. pondérée »). */
  maLabel: string;
  /** Unité d'un pas de temps (« j », « sem. », « mois »), pour la légende. */
  maUnit: string;
  logY: boolean;
}) {
  const W = 680;
  const H = 300;
  const m = { top: 16, right: 16, bottom: 30, left: 44 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [ptr, setPtr] = useState({ px: 0, py: 0 });

  /** Points de l'axe (jours, semaines ou mois selon la granularité). */
  const steps = series[0]?.points ?? [];

  if (series.length === 0 || steps.length === 0) {
    return <div className="empty">Sélectionnez au moins un élément ci-dessous et enregistrez des jours sur la période.</div>;
  }

  const xs = scaleLinear()
    .domain([dayMs(windowDates[0]), dayMs(windowDates[windowDates.length - 1])])
    .range([m.left, W - m.right]);
  // Échelle Y en % de la cible : couvre la courbe affichée (brute ou lissée selon le mode).
  const shownPct = series.flatMap((s) =>
    s.points.map((p) => (maOn ? p.maPct : p.pct)).filter((v): v is number => v != null),
  );
  const maxPct = d3max(shownPct) ?? 100;
  const yMax = Math.max(150, maxPct * 1.1);
  // Log Y : domaine strictement positif (log(0) indéfini). Plancher un cran sous
  // la plus petite valeur affichée, mais jamais au-dessus de 100 % pour garder la
  // ligne cible visible. Les points ≤ 0 % sont laissés en trou (cf. defined()).
  const positivePct = shownPct.filter((v) => v > 0);
  const minPct = positivePct.length ? Math.min(...positivePct) : 1;
  const ys = logY
    ? scaleLog()
        .domain([Math.min(minPct * 0.85, 100), yMax])
        .range([H - m.bottom, m.top])
    : scaleLinear().domain([0, yMax]).nice().range([H - m.bottom, m.top]);

  const yTicks = logY ? ys.ticks(5) : ys.ticks(4);
  const xTicks = xs.ticks(Math.min(6, steps.length));
  const fmtDate = (t: number) => new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  // En log, une valeur ≤ 0 n'est pas plaçable : on la traite comme absente (trou).
  const plottable = (v: number | null): v is number => v != null && (!logY || v > 0);
  const mkLine = (accessor: (p: TrendSeries['points'][number]) => number | null) =>
    d3line<TrendSeries['points'][number]>()
      .defined((p) => plottable(accessor(p)))
      .x((p) => xs(p.t))
      .y((p) => ys(accessor(p) as number));

  const rawLine = mkLine((p) => p.pct);
  const maLine = mkLine((p) => p.maPct);

  function onMove(e: React.MouseEvent) {
    if (!svgRef.current) return;
    const p = toViewBox(e, svgRef.current, W, H);
    let best = 0;
    let bd = Infinity;
    steps.forEach((s, i) => {
      const dist = Math.abs(xs(s.t) - p.x);
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
              {fmt(tk, logY && tk < 10 ? 1 : 0)}%
            </text>
          </g>
        ))}

        {/* ligne cible 100 % */}
        <line x1={m.left} x2={W - m.right} y1={ys(100)} y2={ys(100)} stroke={C.accent2} strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W - m.right} y={ys(100) - 5} fill={C.accent2} fontSize={10} textAnchor="end">
          cible 100 %
        </text>

        {series.map((s) => (
          <g key={s.id}>
            {/* Courbe brute : trait plein seul, ou fin/estompé quand la moyenne mobile est active. */}
            <path
              d={rawLine(s.points) ?? ''}
              fill="none"
              stroke={s.color}
              strokeWidth={maOn ? 1 : 2}
              opacity={maOn ? 0.3 : 1}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {!maOn &&
              s.points.map((p, i) =>
                !plottable(p.pct) ? null : (
                  <circle key={p.date} cx={xs(p.t)} cy={ys(p.pct)} r={hover === i ? 4.5 : 3} fill={s.color} stroke={C.panel2} strokeWidth={1.5} />
                ),
              )}
            {maOn && <path d={maLine(s.points) ?? ''} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />}
          </g>
        ))}

        {xTicks.map((tk) => (
          <text key={tk} x={xs(tk)} y={H - 10} fill={C.muted} fontSize={10} textAnchor="middle">
            {fmtDate(tk)}
          </text>
        ))}

        {hover !== null && (
          <line x1={xs(steps[hover].t)} x2={xs(steps[hover].t)} y1={m.top} y2={H - m.bottom} stroke={C.muted} strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>

      {hover !== null && (
        <Tooltip px={ptr.px} py={ptr.py}>
          <strong>{steps[hover].label}</strong>
          {series.map((s) => {
            const p = s.points[hover];
            return (
              <div key={s.id} style={{ marginTop: 2 }}>
                <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 5 }} />
                {s.label} : <strong>{p.value == null ? '—' : formatSeriesValue(s, p.value)}</strong>
                {p.pct != null && <span style={{ color: p.pct >= 100 ? C.accent2 : C.warn }}> · {fmt(p.pct)} %</span>}
                {maOn && p.maPct != null && <span style={{ color: C.muted }}> · lissé {fmt(p.maPct)} %</span>}
              </div>
            );
          })}
          {maOn && <div className="small" style={{ marginTop: 4, color: C.muted }}>{maLabel} {maWindow} {maUnit}</div>}
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sélecteur unique d'éléments (nutriments + rapports), compact multi-colonnes
// ---------------------------------------------------------------------------

/**
 * Groupes du sélecteur (rapports en tête, puis nutriments par famille), issus du
 * module partagé `nutrition/groups` : une seule source de vérité avec le panneau
 * d'importance. Le groupe « Autres » y est calculé (nutriments non classés).
 */
const PICKER_GROUPS = NUTRIENT_GROUPS;

function Chip({
  id,
  label,
  title,
  selected,
  color,
  onToggle,
}: {
  id: string;
  label: string;
  title?: string;
  selected: boolean;
  color?: string;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`series-chip${selected ? ' on' : ''}`}
      data-tip={title}
      onClick={() => onToggle(id)}
      style={selected && color ? { borderColor: color } : undefined}
    >
      <i style={{ background: selected && color ? color : undefined }} />
      <span>{label}</span>
    </button>
  );
}

function SeriesPicker({
  targets,
  selected,
  colorById,
  onToggle,
}: {
  targets: Target[];
  selected: string[];
  colorById: Map<string, string>;
  onToggle: (id: string) => void;
}) {
  const targetByKey = new Map(targets.map((t) => [t.key, t]));
  return (
    <div className="series-picker">
      <div className="hint" style={{ marginTop: 0, marginBottom: 4 }}>
        Cliquez un élément pour l'ajouter/retirer de la tendance ({selected.length} sélectionné{selected.length > 1 ? 's' : ''}).
      </div>

      <div className="series-group">
        <div className="gh">Rapports</div>
        <div className="series-grid">
          {RATIOS.map((def) => (
            <Chip
              key={def.key}
              id={def.key}
              label={def.label}
              title={def.note}
              selected={selected.includes(def.key)}
              color={colorById.get(def.key)}
              onToggle={onToggle}
            />
          ))}
        </div>
      </div>

      {PICKER_GROUPS.map((g) => (
        <div className="series-group" key={g.title}>
          <div className="gh">{g.title}</div>
          <div className="series-grid">
            {g.keys.map((k) => {
              const t = targetByKey.get(k);
              if (!t) return null;
              return (
                <Chip
                  key={k}
                  id={k}
                  label={t.label}
                  title={t.role}
                  selected={selected.includes(k)}
                  color={colorById.get(k)}
                  onToggle={onToggle}
                />
              );
            })}
          </div>
        </div>
      ))}
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
  /** Répartition ALA/EPA/DHA moyenne/j — renseignée uniquement pour la ligne oméga-3. */
  omega3Detail?: { omega3Ala: number; omega3Epa: number; omega3Dha: number };
}

/** Contenu de l'info-bulle riche d'un nutriment (suivi souris). */
function CoverageCard({ t, avg, pct, isLimit, omega3Detail }: CovRow) {
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
      {t.key === 'vitD' && (
        <div className="small" style={{ marginTop: 8, opacity: 0.9 }}>☀️ Soleil inclus (comme la carte « carence ? »)</div>
      )}
      {omega3Detail && (omega3Detail.omega3Ala > 0 || omega3Detail.omega3Epa > 0 || omega3Detail.omega3Dha > 0) && (
        <Omega3Breakdown totals={{ ...EMPTY_NUTRIENTS, ...omega3Detail }} />
      )}
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
  refMode,
}: {
  averages: Nutrients;
  targets: Target[];
  selected: string[];
  onToggle: (k: NutrientKey) => void;
  /** Référence 100 % des nutriments « à couvrir » (page Stats) — sans effet sur les « à limiter ». */
  refMode: 'optimal' | 'ajr';
}) {
  // Info-bulle unique qui suit la souris (déclenchée par la ligne entière).
  const [tip, setTip] = useState<{ row: CovRow; x: number; y: number } | null>(null);

  // Référence utilisée comme 100 % pour un nutriment « à couvrir », selon refMode.
  const atLeastRef = (t: Target) => (refMode === 'ajr' ? t.ajr : t.optimal);

  const atLeast: CovRow[] = targets
    .filter((t) => t.goal !== 'limit')
    .map((t) => ({
      t,
      avg: averages[t.key],
      pct: atLeastRef(t) > 0 ? (averages[t.key] / atLeastRef(t)) * 100 : 0,
      isLimit: false,
      ...(t.key === 'omega3'
        ? { omega3Detail: { omega3Ala: averages.omega3Ala, omega3Epa: averages.omega3Epa, omega3Dha: averages.omega3Dha } }
        : {}),
    }))
    .sort((a, b) => a.pct - b.pct);
  const limits: CovRow[] = targets
    .filter((t) => t.goal === 'limit')
    .map((t) => ({ t, avg: averages[t.key], pct: t.ajr > 0 ? (averages[t.key] / t.ajr) * 100 : 0, isLimit: true }))
    .sort((a, b) => b.pct - a.pct);

  function row(r: CovRow) {
    const { t, avg, pct, isLimit } = r;
    const width = (Math.min(pct, CAP) / CAP) * 100;
    const barClass = isLimit ? (pct > 100 ? 'over' : avg <= t.optimal ? 'good' : '') : pct >= 100 ? 'good' : '';
    // Repère à 100 % = la référence qui sert au calcul de `pct` (plafond pour les
    // « à limiter », sinon optimal ou AJR selon `refMode`) ; l'autre repère se
    // place proportionnellement, borné à CAP pour rester dans la barre.
    const primaryIsAjr = isLimit || refMode === 'ajr';
    const primaryRef = isLimit ? t.ajr : refMode === 'ajr' ? t.ajr : t.optimal;
    const secondaryRef = isLimit ? t.optimal : refMode === 'ajr' ? t.optimal : t.ajr;
    const secondaryPct = primaryRef > 0 ? (secondaryRef / primaryRef) * 100 : 0;
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
          <span className={`mark ${primaryIsAjr ? 'opti' : 'ajr'}`} style={{ left: `${(Math.min(secondaryPct, CAP) / CAP) * 100}%` }} />
          <span className={`mark ${primaryIsAjr ? 'ajr' : 'opti'}`} style={{ left: `${(100 / CAP) * 100}%` }} />
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
