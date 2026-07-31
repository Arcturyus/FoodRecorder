import { useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line } from 'd3-shape';
import { extent as d3extent } from 'd3-array';
import { useStore, todayStr, isDayCounted } from '../store/store';
import { computeWeight } from '../weight/compute';
import type { WeightEntry } from '../weight/types';
import {
  PeriodSelector,
  resolveRange,
  defaultPeriodState,
} from './PeriodSelector';
import type { PeriodState } from './PeriodSelector';
import { fmt } from './format';
import { NumberField } from './NumberField';

const C = {
  accent: '#5b8cff',
  accent2: '#3ecf8e',
  warn: '#f5a623',
  danger: '#ef5d5d',
  violet: '#a78bfa',
  muted: '#9aa2b1',
  border: '#2a2f3a',
  text: '#e6e8ec',
  panel2: '#1f232c',
};

const DAY_MS = 86_400_000;

/** Fenêtres proposées pour la moyenne mobile (en jours) — mêmes choix que Stats. */
const MA_WINDOWS = [3, 7, 14, 30];

/** Timestamp d'une pesée (date + heure) pour l'axe temporel. */
function entryMs(e: WeightEntry): number {
  return new Date(`${e.date}T${e.heure || '12:00'}:00`).getTime();
}

/** Timestamp de midi d'un jour (points journaliers : kcal…). */
function dayMs(date: string): number {
  return new Date(`${date}T12:00:00`).getTime();
}

function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function fmtDateTime(e: WeightEntry): string {
  return `${new Date(`${e.date}T00:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} ${e.heure}`;
}

/** Une pesée « comparable » : à jeun et nu (sinon point creux sur la courbe). */
function isComparable(e: WeightEntry): boolean {
  return e.aJeun && e.nu;
}

interface SeriesPoint {
  t: number;
  value: number;
  e?: WeightEntry;
  /** Point creux/grisé : mesure moins comparable (non à jeun / habillé). */
  hollow?: boolean;
}

interface Series {
  label: string;
  color: string;
  points: SeriesPoint[];
  dashed?: boolean;
  /** Axe de droite (unité différente, ex. kcal superposées au poids). */
  rightAxis?: boolean;
  /** Dessiner les points individuels (sinon ligne seule). */
  drawPoints?: boolean;
  /**
   * Survolable sans dessiner de points. Les courbes lissées n'ont pas de survol
   * par défaut (on veut atterrir sur une vraie mesure) — sauf quand elles sont
   * SEULES à l'écran, sinon le graphe n'aurait plus aucun tooltip.
   */
  hoverable?: boolean;
  /** Unité affichée dans le tooltip (défaut : unité du graphe). */
  unit?: string;
}

/**
 * kcal mangées par jour sur une plage, prêtes à superposer à la courbe de poids.
 *
 * Ne comptent que les jours ENREGISTRÉS : un jour vide est un jour non rempli,
 * pas un jour à 0 kcal — le moyenner à 0 écraserait la courbe. Deux exceptions,
 * portées par `mutedDays` (même règle que les moyennes de Stats, pour que les
 * deux racontent la même histoire) :
 *  - un jour vide explicitement compté (jeûne) vaut bien 0 ;
 *  - un jour muté (mal rempli) est ignoré même s'il contient des entrées.
 */
export function dailyKcalPoints(
  journal: { date: string; items: { nutrients: { kcal: number } }[] }[],
  mutedDays: Record<string, boolean>,
  range: { start: string; end: string },
): SeriesPoint[] {
  const kcalByDate = new Map<string, number>();
  for (const e of journal) {
    const kcal = e.items.reduce((a, it) => a + it.nutrients.kcal, 0);
    kcalByDate.set(e.date, (kcalByDate.get(e.date) ?? 0) + kcal);
  }
  const out: SeriesPoint[] = [];
  for (let t = dayMs(range.start); t <= dayMs(range.end); t += DAY_MS) {
    const date = todayStr(new Date(t));
    const kcal = kcalByDate.get(date);
    if (!isDayCounted(mutedDays, kcal != null, date)) continue;
    out.push({ t, value: kcal ?? 0 });
  }
  return out;
}

/** Moyenne mobile : pour chaque point, moyenne des valeurs des `days` jours précédents (inclus). */
function movingAverage(points: SeriesPoint[], days: number): SeriesPoint[] {
  return points.map((p) => {
    const windowStart = p.t - days * DAY_MS;
    const win = points.filter((q) => q.t > windowStart && q.t <= p.t);
    return { t: p.t, value: win.reduce((a, q) => a + q.value, 0) / win.length };
  });
}

/** Pente (unité/jour) par régression linéaire simple. `null` si < 2 points. */
function slopePerDay(points: SeriesPoint[]): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mt = points.reduce((a, p) => a + p.t, 0) / n;
  const mv = points.reduce((a, p) => a + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - mt) * (p.value - mv);
    den += (p.t - mt) * (p.t - mt);
  }
  if (den === 0) return null;
  return (num / den) * DAY_MS;
}

/**
 * Modes du graphe : mesures directes, valeurs calculées (IMC, métabolismes),
 * et « Autres » (métriques secondaires regroupées : masse osseuse + graisse viscérale).
 */
type ChartMode = 'poids' | 'masseGrasse' | 'eau' | 'masseMusculaire' | 'imc' | 'metabolismes' | 'autres';

const MODE_CHIPS: { key: ChartMode; label: string; title?: string }[] = [
  { key: 'poids', label: 'Poids' },
  { key: 'masseGrasse', label: 'Masse grasse' },
  { key: 'eau', label: 'Eau' },
  { key: 'masseMusculaire', label: 'Masse musculaire', title: 'kg par défaut (% × poids), bascule kg / % sous le graphe' },
  { key: 'imc', label: 'IMC', title: 'Indice de masse corporelle calculé (poids / taille²)' },
  { key: 'metabolismes', label: 'Métabolismes', title: 'Harris-Benedict, Mifflin-St Jeor et balance — basal ou × multiplicateur d’activité' },
  { key: 'autres', label: 'Autres', title: 'Métriques secondaires : masse osseuse + graisse viscérale' },
];

/**
 * Courbes d'évolution des pesées, sur la période choisie :
 *  - mesures directes (poids, masse grasse, eau) avec moyenne mobile 7 j ;
 *  - masse musculaire en kg (% × poids, avec la part squelettique) ou en %
 *    (bascule binaire) ;
 *  - valeurs calculées : IMC ; métabolismes HB / MSJ / balance sur un même
 *    graphe (cases à cocher), en basal ou × multiplicateur d'activité ;
 *  - « Autres » : masse osseuse (axe gauche) + graisse viscérale (axe droit) ;
 *  - pour le poids : superposition de la moyenne kcal des jours précédents,
 *    ligne d'objectif + date d'atteinte estimée, pesées non à jeun / habillées
 *    en points creux (moins comparables).
 */
export function WeightChart({ onEditEntry }: { onEditEntry?: (id: string) => void } = {}) {
  const entries = useStore((s) => s.weightEntries);
  const journal = useStore((s) => s.entries);
  const weightConfig = useStore((s) => s.weightConfig);
  const setWeightConfig = useStore((s) => s.setWeightConfig);
  const sexe = useStore((s) => s.profile.sexe);

  const mutedDays = useStore((s) => s.mutedDays);

  const [period, setPeriod] = useState<PeriodState>(defaultPeriodState);
  const [mode, setMode] = useState<ChartMode>('poids');
  const [showMa, setShowMa] = useState(true);
  /** Fenêtre de la moyenne mobile, en jours (réglable comme dans Stats). */
  const [maWindow, setMaWindow] = useState(7);
  const [showKcal, setShowKcal] = useState(false);
  /** Ne garder que les pesées comparables (à jeun ET nu). */
  const [comparableOnly, setComparableOnly] = useState(false);
  /** Filtre horaire : pesées avant 11h et/ou après 14h (aucun coché = tout). */
  const [heureFilter, setHeureFilter] = useState({ before11: false, after14: false });
  /** Masse musculaire : kg par défaut (% × poids), bascule vers le % mesuré. */
  const [muscleUnit, setMuscleUnit] = useState<'kg' | '%'>('kg');
  /** Métabolismes : courbes affichées + basal ou × multiplicateur d'activité. */
  const [metaboShow, setMetaboShow] = useState({ hb: true, msj: true, machine: true });
  const [withActivity, setWithActivity] = useState(false);

  const earliest = useMemo(() => {
    if (entries.length === 0) return undefined;
    return entries.reduce((min, e) => (e.date < min ? e.date : min), entries[0].date);
  }, [entries]);

  const range = useMemo(() => resolveRange(period, earliest), [period, earliest]);

  /** Pesées de la période, triées chronologiquement. */
  const inRange = useMemo(
    () =>
      entries
        .filter((e) => e.date >= range.start && e.date <= range.end)
        .filter((e) => !comparableOnly || isComparable(e))
        .filter((e) => {
          const { before11, after14 } = heureFilter;
          if (!before11 && !after14) return true;
          return (before11 && e.heure < '11:00') || (after14 && e.heure >= '14:00');
        })
        .sort((a, b) => entryMs(a) - entryMs(b)),
    [entries, range, comparableOnly, heureFilter],
  );

  /** Valeurs calculées par pesée (IMC, squelettique, métabolismes). */
  const computedByEntry = useMemo(
    () =>
      new Map(
        inRange.map((e) => [
          e.id,
          computeWeight({ poids: e.poids, masseMusculaire: e.masseMusculaire }, weightConfig, sexe),
        ]),
      ),
    [inRange, weightConfig, sexe],
  );

  /** Points de la série principale du mode courant (sert aux stats + moyenne mobile). */
  const points: SeriesPoint[] = useMemo(() => {
    const base = (get: (e: WeightEntry) => number | null | undefined): SeriesPoint[] =>
      inRange.flatMap((e) => {
        const v = get(e);
        return v == null ? [] : [{ e, t: entryMs(e), value: v, hollow: !isComparable(e) }];
      });
    switch (mode) {
      case 'poids':
        return base((e) => e.poids);
      case 'masseGrasse':
        return base((e) => e.masseGrasse);
      case 'eau':
        return base((e) => e.eau);
      case 'masseMusculaire':
        return muscleUnit === '%'
          ? base((e) => e.masseMusculaire)
          : base((e) => (e.masseMusculaire != null ? (e.poids * e.masseMusculaire) / 100 : null));
      case 'imc':
        return base((e) => computedByEntry.get(e.id)?.imc);
      default:
        return [];
    }
  }, [mode, muscleUnit, inRange, computedByEntry]);

  /** kcal mangées, un point par jour enregistré de la période (cf. dailyKcalPoints). */
  const kcalPoints: SeriesPoint[] = useMemo(
    () => (mode !== 'poids' || !showKcal ? [] : dailyKcalPoints(journal, mutedDays, range)),
    [mode, showKcal, journal, range, mutedDays],
  );

  /**
   * Séries du mode « Métabolismes » : HB / MSJ / balance (cases à cocher),
   * basal ou × multiplicateur d'activité (les trois sont des basaux, le même
   * multiplicateur s'applique).
   */
  const metaboSeries: Series[] = useMemo(() => {
    if (mode !== 'metabolismes') return [];
    const mult = withActivity ? weightConfig.activityMultiplier : 1;
    const suffix = withActivity ? ` × ${fmt(weightConfig.activityMultiplier, 2)}` : '';
    const hb: SeriesPoint[] = [];
    const msj: SeriesPoint[] = [];
    const machine: SeriesPoint[] = [];
    for (const e of inRange) {
      const t = entryMs(e);
      const c = computedByEntry.get(e.id)!;
      hb.push({ e, t, value: c.bmrHarrisBenedict * mult });
      msj.push({ e, t, value: c.bmrMifflinStJeor * mult });
      if (e.metabolismeBasalMachine != null) machine.push({ e, t, value: e.metabolismeBasalMachine * mult });
    }
    const out: Series[] = [];
    if (metaboShow.hb) out.push({ label: `Harris-Benedict${suffix}`, color: C.accent, points: hb, drawPoints: true });
    if (metaboShow.msj) out.push({ label: `Mifflin-St Jeor${suffix}`, color: C.accent2, points: msj, drawPoints: true });
    if (metaboShow.machine) out.push({ label: `Balance${suffix}`, color: C.warn, points: machine, drawPoints: true });
    return out;
  }, [mode, inRange, computedByEntry, weightConfig.activityMultiplier, metaboShow, withActivity]);

  /** Séries du mode « Autres » : masse osseuse (axe gauche) + graisse viscérale (axe droit). */
  const autresSeries: Series[] = useMemo(() => {
    if (mode !== 'autres') return [];
    const os: SeriesPoint[] = [];
    const visc: SeriesPoint[] = [];
    for (const e of inRange) {
      const t = entryMs(e);
      if (e.masseOsseuse != null) os.push({ e, t, value: e.masseOsseuse, hollow: !isComparable(e) });
      if (e.graisseViscerale != null) visc.push({ e, t, value: e.graisseViscerale, hollow: !isComparable(e) });
    }
    return [
      { label: 'Masse osseuse', color: C.accent, points: os, drawPoints: true, unit: 'kg' },
      { label: 'Graisse viscérale', color: C.violet, points: visc, drawPoints: true, rightAxis: true, unit: '' },
    ];
  }, [mode, inRange]);

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    const vals = points.map((p) => p.value);
    const first = vals[0];
    const last = vals[vals.length - 1];
    return {
      first,
      last,
      delta: last - first,
      min: Math.min(...vals),
      max: Math.max(...vals),
      avg: vals.reduce((a, v) => a + v, 0) / vals.length,
    };
  }, [points]);

  // Objectif de poids : ligne cible + estimation de la date d'atteinte au rythme
  // actuel (pente de la moyenne mobile sur les 30 derniers jours de données).
  // Même fenêtre que la courbe affichée : la tendance annoncée doit être celle
  // qu'on voit, sinon élargir le lissage donnerait une ETA contredite par le graphe.
  const objectif = weightConfig.objectifPoids;
  const eta = useMemo(() => {
    if (mode !== 'poids' || objectif == null || points.length < 2) return null;
    const ma = movingAverage(points, maWindow);
    const lastT = ma[ma.length - 1].t;
    const recent = ma.filter((p) => p.t >= lastT - 30 * DAY_MS);
    const slope = slopePerDay(recent.length >= 2 ? recent : ma);
    if (slope == null) return null;
    const current = ma[ma.length - 1].value;
    const gap = objectif - current;
    const perWeek = slope * 7;
    if (Math.abs(gap) < 0.15) return { label: 'objectif atteint 🎉', perWeek };
    if (Math.abs(slope) < 0.003 || Math.sign(gap) !== Math.sign(slope)) {
      return { label: 'pas en voie de l’atteindre au rythme actuel', perWeek };
    }
    const days = gap / slope;
    if (days > 365 * 3) return { label: 'à plus de 3 ans au rythme actuel', perWeek };
    const when = new Date(lastT + days * DAY_MS).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return { label: `atteint vers le ${when}`, perWeek };
  }, [mode, objectif, points, maWindow]);

  const isComposite = mode === 'metabolismes' || mode === 'autres';
  const unit =
    mode === 'metabolismes' ? 'kcal'
    : mode === 'imc' ? ''
    : mode === 'masseGrasse' || mode === 'eau' ? '%'
    : mode === 'masseMusculaire' ? muscleUnit
    : mode === 'autres' ? 'kg'
    : 'kg';

  /**
   * Assemble les séries à tracer selon le mode et les options.
   *
   * Moyenne mobile active ⇒ on n'affiche QUE les courbes lissées (mesures,
   * squelettique, kcal). Superposer brut + lissé pour trois séries rendait le
   * graphe illisible. Contrepartie assumée : les points de pesée (et donc le
   * clic pour éditer) ne reviennent qu'en décochant la moyenne mobile.
   */
  const series: Series[] = useMemo(() => {
    if (mode === 'metabolismes') return metaboSeries;
    if (mode === 'autres') return autresSeries;
    const label =
      mode === 'masseMusculaire'
        ? muscleUnit === 'kg' ? 'Masse musculaire (kg)' : 'Masse musculaire (%)'
        : MODE_CHIPS.find((c) => c.key === mode)!.label;
    const smoothed = showMa && points.length >= 2;
    const ma = (p: SeriesPoint[]) => movingAverage(p, maWindow);
    const suffix = ` · moy. ${maWindow} j`;

    const out: Series[] = smoothed
      ? [{ label: label + suffix, color: C.accent2, points: ma(points), hoverable: true }]
      : [{ label, color: C.accent, points, drawPoints: true }];

    // En kg, la part squelettique (× 0,9, cf. compute.ts) accompagne la courbe.
    if (mode === 'masseMusculaire' && muscleUnit === 'kg') {
      const skel = inRange.flatMap((e) => {
        const v = computedByEntry.get(e.id)?.masseMusculaireSquelettique;
        return v == null ? [] : [{ e, t: entryMs(e), value: v }];
      });
      out.push({
        label: `dont squelettique (× 0,9)${smoothed ? suffix : ''}`,
        color: C.violet,
        points: smoothed && skel.length >= 2 ? ma(skel) : skel,
        dashed: true,
      });
    }

    if (kcalPoints.length > 0) {
      const lisse = smoothed && kcalPoints.length >= 2;
      out.push({
        label: lisse ? `kcal mangées${suffix}` : 'kcal mangées (par jour)',
        color: C.warn,
        points: lisse ? ma(kcalPoints) : kcalPoints,
        rightAxis: true,
        dashed: true,
        unit: 'kcal',
      });
    }
    return out;
  }, [mode, muscleUnit, points, showMa, maWindow, kcalPoints, metaboSeries, autresSeries, inRange, computedByEntry]);

  const targetLine = mode === 'poids' && objectif != null ? { value: objectif, label: `objectif ${fmt(objectif, 1)} kg` } : null;
  const hasHollow = series.some((s) => s.points.some((p) => p.hollow));

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>Évolution</h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0' }}>
        {MODE_CHIPS.map((m) => (
          <button
            key={m.key}
            className={mode === m.key ? 'chip-active' : 'ghost'}
            onClick={() => setMode(m.key)}
            data-tip={m.title}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
        <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} data-tip="Exclut les pesées non à jeun ou habillées, au lieu de simplement les griser">
          <input type="checkbox" checked={comparableOnly} onChange={(e) => setComparableOnly(e.target.checked)} style={{ width: 'auto' }} />
          À jeun &amp; nu uniquement
        </label>
        <span className="row" style={{ gap: 10 }} data-tip="Filtrer par heure de pesée (aucune case cochée = toutes les heures)">
          <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={heureFilter.before11}
              onChange={(e) => setHeureFilter((f) => ({ ...f, before11: e.target.checked }))}
              style={{ width: 'auto' }}
            />
            Avant 11h
          </label>
          <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={heureFilter.after14}
              onChange={(e) => setHeureFilter((f) => ({ ...f, after14: e.target.checked }))}
              style={{ width: 'auto' }}
            />
            Après 14h
          </label>
        </span>
      </div>

      {!isComposite && (
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          {mode === 'masseMusculaire' && (
            <span className="row" style={{ gap: 0 }} data-tip="kg = % mesuré × poids ; % = valeur brute de la balance">
              <button className={`small ${muscleUnit === 'kg' ? 'chip-active' : 'ghost'}`} onClick={() => setMuscleUnit('kg')}>
                kg
              </button>
              <button className={`small ${muscleUnit === '%' ? 'chip-active' : 'ghost'}`} onClick={() => setMuscleUnit('%')}>
                %
              </button>
            </span>
          )}
          <span className="row" style={{ gap: 6, alignItems: 'center' }} data-tip="Lisse le bruit des pesées. Active, elle remplace les courbes brutes (y compris les kcal) au lieu de s'y ajouter — décochez-la pour revoir les mesures et cliquer un point.">
            <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={showMa} onChange={(e) => setShowMa(e.target.checked)} style={{ width: 'auto' }} />
              Moyenne mobile
            </label>
            <select
              value={maWindow}
              onChange={(e) => setMaWindow(Number(e.target.value))}
              disabled={!showMa}
              style={{ opacity: showMa ? 1 : 0.5, width: 'auto' }}
              aria-label="Fenêtre de la moyenne mobile"
            >
              {MA_WINDOWS.map((w) => (
                <option key={w} value={w}>
                  {w} j
                </option>
              ))}
            </select>
          </span>
          {mode === 'poids' && (
            <>
              <label
                className="small"
                style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                data-tip="Jours enregistrés uniquement : un jour vide est un jour non rempli, pas un jour à 0 kcal. Exception : un jour vide marqué « compté » sur le calendrier (jeûne) vaut bien 0."
              >
                <input type="checkbox" checked={showKcal} onChange={(e) => setShowKcal(e.target.checked)} style={{ width: 'auto' }} />
                Superposer kcal mangées
              </label>
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Objectif (kg)
                <NumberField
                  step={0.1}
                  placeholder="ex. 68"
                  value={objectif ?? ''}
                  onChange={(raw) => {
                    const v = parseFloat(raw.replace(',', '.'));
                    setWeightConfig({ objectifPoids: Number.isFinite(v) && v > 0 ? v : undefined });
                  }}
                  style={{ width: 118 }}
                />
              </label>
            </>
          )}
        </div>
      )}

      {mode === 'metabolismes' && (
        <div className="row" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
          <span className="row" style={{ gap: 0 }} data-tip={`Multiplie les courbes par le multiplicateur d'activité (${fmt(weightConfig.activityMultiplier, 2)}, réglable dans les constantes)`}>
            <button className={`small ${!withActivity ? 'chip-active' : 'ghost'}`} onClick={() => setWithActivity(false)}>
              Basal
            </button>
            <button className={`small ${withActivity ? 'chip-active' : 'ghost'}`} onClick={() => setWithActivity(true)}>
              × {fmt(weightConfig.activityMultiplier, 2)} (activité)
            </button>
          </span>
          {(
            [
              ['hb', 'Harris-Benedict'],
              ['msj', 'Mifflin-St Jeor'],
              ['machine', 'Balance'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="small" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={metaboShow[k]}
                onChange={(e) => setMetaboShow((s) => ({ ...s, [k]: e.target.checked }))}
                style={{ width: 'auto' }}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      {stats && !isComposite && (
        <div className="hint" style={{ marginTop: -2 }}>
          {points.length} mesure(s) · dernier <strong>{fmt(stats.last, 1)} {unit}</strong> · variation{' '}
          <strong style={{ color: stats.delta === 0 ? C.muted : stats.delta > 0 ? C.warn : C.accent2 }}>
            {stats.delta > 0 ? '+' : ''}
            {fmt(stats.delta, 1)} {unit}
          </strong>{' '}
          · min {fmt(stats.min, 1)} · max {fmt(stats.max, 1)} · moy {fmt(stats.avg, 1)} {unit}
        </div>
      )}

      {mode === 'poids' && objectif != null && eta && (
        <div className="hint">
          🎯 Objectif <strong>{fmt(objectif, 1)} kg</strong> : tendance actuelle{' '}
          <strong style={{ color: eta.perWeek > 0 ? C.warn : C.accent2 }}>
            {eta.perWeek > 0 ? '+' : ''}
            {fmt(eta.perWeek, 2)} kg/sem
          </strong>{' '}
          → <strong>{eta.label}</strong>
        </div>
      )}

      <MultiLineChart
        series={series}
        unit={unit}
        target={targetLine}
        onZoom={(r) => setPeriod({ preset: 'custom', custom: r })}
        onPointClick={onEditEntry}
      />

      <div className="hint" style={{ marginTop: 4 }}>
        Glisser sur le graphe pour zoomer sur une plage · cliquer un point pour éditer la pesée.
      </div>

      <div className="row small" style={{ gap: 14, marginTop: 8, flexWrap: 'wrap', color: C.muted }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: `2px ${s.dashed ? 'dashed' : 'solid'} ${s.color}` }} />
            {s.label}
            {s.rightAxis ? ' (axe droit)' : ''}
          </span>
        ))}
        {targetLine && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 0, borderTop: `2px dashed ${C.danger}` }} />
            {targetLine.label}
          </span>
        )}
        {hasHollow && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                border: `2px solid ${C.muted}`,
                background: 'transparent',
              }}
            />
            non à jeun / habillé (moins comparable)
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Graphe multi-séries générique : axe gauche partagé par les séries principales,
 * axe droit optionnel (unité différente), ligne cible horizontale, tooltip.
 */
function MultiLineChart({
  series,
  unit,
  target,
  onZoom,
  onPointClick,
}: {
  series: Series[];
  unit: string;
  target: { value: number; label: string } | null;
  /** Glisser-déposer horizontal sur le graphe → zoome sur la plage de dates sélectionnée. */
  onZoom?: (range: { start: string; end: string }) => void;
  /** Clic sur un point relié à une pesée → ouvre son édition dans l'historique. */
  onPointClick?: (entryId: string) => void;
}) {
  const W = 680;
  const H = 300;
  const m = { top: 16, right: 46, bottom: 30, left: 46 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ si: number; pi: number } | null>(null);
  const [ptr, setPtr] = useState({ px: 0, py: 0 });
  /** Glisser en cours : position (unités SVG) du point de départ et courant. */
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null);

  const leftSeries = series.filter((s) => !s.rightAxis && s.points.length > 0);
  const rightSeries = series.filter((s) => s.rightAxis && s.points.length > 0);
  const allPoints = series.flatMap((s) => s.points);

  if (leftSeries.length === 0 || leftSeries.every((s) => s.points.length === 0)) {
    return <div className="empty">Aucune mesure sur cette période pour cette métrique.</div>;
  }

  const [t0, t1] = d3extent(allPoints, (p) => p.t) as [number, number];
  const xs = scaleLinear()
    .domain(t0 === t1 ? [t0 - DAY_MS, t1 + DAY_MS] : [t0, t1])
    .range([m.left, W - m.right]);

  const leftVals = leftSeries.flatMap((s) => s.points.map((p) => p.value));
  if (target) leftVals.push(target.value);
  const [v0, v1] = [Math.min(...leftVals), Math.max(...leftVals)];
  const pad = (v1 - v0) * 0.15 || Math.max(1, v0 * 0.02);
  const ys = scaleLinear().domain([v0 - pad, v1 + pad]).nice().range([H - m.bottom, m.top]);

  const rightVals = rightSeries.flatMap((s) => s.points.map((p) => p.value));
  const [r0, r1] = rightVals.length > 0 ? [Math.min(...rightVals), Math.max(...rightVals)] : [0, 1];
  const rpad = (r1 - r0) * 0.15 || Math.max(1, r0 * 0.02);
  const yr = scaleLinear().domain([r0 - rpad, r1 + rpad]).nice().range([H - m.bottom, m.top]);

  const yScaleFor = (s: Series) => (s.rightAxis ? yr : ys);
  const yTicks = ys.ticks(5);
  const rTicks = rightSeries.length > 0 ? yr.ticks(5) : [];
  const rightColor = rightSeries[0]?.color ?? C.warn;
  const nX = Math.max(...leftSeries.map((s) => s.points.length));
  const xTicks = xs.ticks(Math.min(6, Math.max(2, nX)));

  /** Point le plus proche des coordonnées SVG données, toutes séries à points confondues. */
  function nearestPoint(x: number, y: number): { si: number; pi: number; dxPx: number } | null {
    let best: { si: number; pi: number } | null = null;
    let bd = Infinity;
    let bestDx = Infinity;
    series.forEach((s, si) => {
      if (!s.drawPoints && !s.rightAxis && !s.hoverable) return; // séries lissées : pas de survol dédié
      const yScale = yScaleFor(s);
      s.points.forEach((p, pi) => {
        const dx = xs(p.t) - x;
        const dy = (yScale(p.value) - y) * 0.35; // priorité à la proximité horizontale
        const dist = dx * dx + dy * dy;
        if (dist < bd) {
          bd = dist;
          best = { si, pi };
          bestDx = Math.abs(dx);
        }
      });
    });
    return best ? { si: (best as { si: number; pi: number }).si, pi: (best as { si: number; pi: number }).pi, dxPx: bestDx } : null;
  }

  function svgCoords(ev: React.MouseEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
      px: ((ev.clientX - rect.left) / rect.width) * 100,
      py: ((ev.clientY - rect.top) / rect.height) * 100,
    };
  }

  function onMove(ev: React.MouseEvent) {
    if (!svgRef.current) return;
    const { x, y, px, py } = svgCoords(ev);
    if (drag) {
      setDrag((d) => (d ? { ...d, x1: x } : d));
      return;
    }
    setHover(nearestPoint(x, y));
    setPtr({ px, py });
  }

  function onDown(ev: React.MouseEvent) {
    if (!svgRef.current) return;
    const { x } = svgCoords(ev);
    setHover(null);
    setDrag({ x0: x, x1: x });
  }

  function onUp(ev: React.MouseEvent) {
    if (!svgRef.current || !drag) return;
    const { x } = svgCoords(ev);
    const moved = Math.abs(x - drag.x0);
    if (moved < 6) {
      // Glissement négligeable : traité comme un clic sur le point le plus proche.
      const nearest = nearestPoint(x, ((ev.clientY - svgRef.current.getBoundingClientRect().top) / svgRef.current.getBoundingClientRect().height) * H);
      const p = nearest && nearest.dxPx < 14 ? series[nearest.si]?.points[nearest.pi] : null;
      if (p?.e && onPointClick) onPointClick(p.e.id);
    } else if (onZoom) {
      const [xa, xb] = [Math.min(drag.x0, x), Math.max(drag.x0, x)];
      const ta = xs.invert(xa);
      const tb = xs.invert(xb);
      onZoom({ start: todayStr(new Date(ta)), end: todayStr(new Date(tb)) });
    }
    setDrag(null);
  }

  const hovered = hover ? series[hover.si]?.points[hover.pi] : null;
  const hoveredSeries = hover ? series[hover.si] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
        onMouseMove={onMove}
        onMouseDown={onDown}
        onMouseUp={onUp}
        onMouseLeave={() => {
          setHover(null);
          setDrag(null);
        }}
      >
        {yTicks.map((tk) => (
          <g key={tk}>
            <line x1={m.left} x2={W - m.right} y1={ys(tk)} y2={ys(tk)} stroke={C.border} strokeWidth={1} />
            <text x={m.left - 8} y={ys(tk)} fill={C.muted} fontSize={10} textAnchor="end" dominantBaseline="middle">
              {fmt(tk, 1)}
            </text>
          </g>
        ))}
        {rTicks.map((tk) => (
          <text
            key={`r${tk}`}
            x={W - m.right + 8}
            y={yr(tk)}
            fill={rightColor}
            fontSize={10}
            textAnchor="start"
            dominantBaseline="middle"
            opacity={0.9}
          >
            {fmt(tk)}
          </text>
        ))}

        {target && (
          <g>
            <line
              x1={m.left}
              x2={W - m.right}
              y1={ys(target.value)}
              y2={ys(target.value)}
              stroke={C.danger}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text x={W - m.right - 4} y={ys(target.value) - 5} fill={C.danger} fontSize={10} textAnchor="end">
              {target.label}
            </text>
          </g>
        )}

        {series.map((s, si) => {
          if (s.points.length === 0) return null;
          const yScale = yScaleFor(s);
          const lineGen = d3line<SeriesPoint>().x((d) => xs(d.t)).y((d) => yScale(d.value));
          return (
            <g key={s.label}>
              <path
                d={lineGen(s.points)!}
                fill="none"
                stroke={s.color}
                strokeWidth={si === 0 ? 2 : 1.8}
                strokeDasharray={s.dashed ? '5 4' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={s.rightAxis ? 0.85 : 1}
              />
              {s.drawPoints &&
                s.points.map((p, pi) => {
                  const active = hover?.si === si && hover?.pi === pi;
                  return p.hollow ? (
                    <circle
                      key={pi}
                      cx={xs(p.t)}
                      cy={yScale(p.value)}
                      r={active ? 4.5 : 3.2}
                      fill={C.panel2}
                      stroke={C.muted}
                      strokeWidth={1.6}
                    />
                  ) : (
                    <circle
                      key={pi}
                      cx={xs(p.t)}
                      cy={yScale(p.value)}
                      r={active ? 4.5 : 3}
                      fill={s.color}
                      stroke={C.panel2}
                      strokeWidth={1.5}
                    />
                  );
                })}
            </g>
          );
        })}

        {xTicks.map((tk) => (
          <text key={tk} x={xs(tk)} y={H - 10} fill={C.muted} fontSize={10} textAnchor="middle">
            {fmtDate(tk)}
          </text>
        ))}

        {hovered && !drag && (
          <line
            x1={xs(hovered.t)}
            x2={xs(hovered.t)}
            y1={m.top}
            y2={H - m.bottom}
            stroke={C.muted}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {drag && Math.abs(drag.x1 - drag.x0) >= 6 && (
          <rect
            x={Math.min(drag.x0, drag.x1)}
            y={m.top}
            width={Math.abs(drag.x1 - drag.x0)}
            height={H - m.top - m.bottom}
            fill={C.accent}
            opacity={0.15}
            stroke={C.accent}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
      </svg>

      {hovered && hoveredSeries && (
        <div
          style={{
            position: 'absolute',
            left: `${ptr.px}%`,
            top: `${ptr.py}%`,
            transform: `translate(${ptr.px > 65 ? '-100%' : '-50%'}, -115%)`,
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
          <strong>{hovered.e ? fmtDateTime(hovered.e) : fmtDate(hovered.t)}</strong>
          <br />
          <span style={{ color: hoveredSeries.color }}>{hoveredSeries.label}</span> :{' '}
          {fmt(hovered.value, 1)} {hoveredSeries.unit ?? unit}
          {hovered.e && !isComparable(hovered.e) && (
            <>
              <br />
              <span style={{ color: C.muted }}>
                ⚠ {[!hovered.e.aJeun && 'non à jeun', !hovered.e.nu && 'habillé'].filter(Boolean).join(', ')}
              </span>
            </>
          )}
          {hovered.e?.remarque && (
            <>
              <br />
              <span style={{ color: C.muted }}>« {hovered.e.remarque} »</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
