import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { useStore, useEffectiveFoods } from '../store/store';
import type { JournalEntry } from '../store/store';
import { normalize } from '../nutrition/normalize';
import {
  foodFrequencies,
  foodPairFrequencies,
  occurrencesByDate,
  nutrientContributions,
} from '../nutrition/frequency';
import type { FoodFrequency, NutrientContribution } from '../nutrition/frequency';
import { NUTRIENT_GROUPS } from '../nutrition/groups';
import { EXTRA_NUTRIENT_META } from '../nutrition/rda';
import { useTargets } from './useTargets';
import type { Target } from '../nutrition/targets';
import type { Food, FoodCategory, NutrientKey } from '../nutrition/types';
import { sunVitDForDate } from '../sun/vitaminD';
import {
  PeriodSelector,
  GranularitySelector,
  groupDates,
  resolveRange,
  datesInRange,
  rangeDays,
  defaultPeriodState,
} from './PeriodSelector';
import type { PeriodState, Granularity, DateBucket } from './PeriodSelector';
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
type ConsoMode = 'classement' | 'ensemble' | 'nutriment';

export function FoodConsumption() {
  const entries = useStore((s) => s.entries);
  const foods = useEffectiveFoods();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriodState);
  const [excludeSupplements, setExcludeSupplements] = useState(true);
  const [mode, setMode] = useState<ConsoMode>('classement');
  /** Pas de temps des graphiques de détail (une barre par jour, semaine ou mois). */
  const [gran, setGran] = useState<Granularity>('jour');

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
        <button className={`ghost small ${mode === 'nutriment' ? 'chip-active' : ''}`} onClick={() => setMode('nutriment')}>
          Par nutriment
        </button>
      </div>
      <div className="row" style={{ alignItems: 'center', marginTop: 10, gap: 16, flexWrap: 'wrap' }}>
        <label
          className="row small"
          style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}
          data-tip="Retire les compléments et assaisonnements (créatine, whey, sel…) du classement : pris tous les jours, ils écraseraient le haut du tableau."
        >
          <input
            type="checkbox"
            checked={excludeSupplements}
            onChange={(e) => setExcludeSupplements(e.target.checked)}
          />
          Sans les suppléments
        </label>
        {mode !== 'ensemble' && (
          <GranularitySelector
            value={gran}
            onChange={setGran}
            tip="Regroupe les barres des graphiques de détail (« quand ? », « combien ? ») par jour, semaine ou mois."
          />
        )}
      </div>
      {mode === 'classement' && (
        <>
          <p className="small" style={{ marginTop: 2 }}>
            Classement sur la période, d'après votre journal. Cliquez un aliment pour voir <em>quand</em> vous l'avez
            mangé.
          </p>
          <FoodFrequencyPanel entries={freqEntries} range={range} days={days} foods={foods} gran={gran} />
        </>
      )}
      {mode === 'ensemble' && (
        <>
          <p className="small" style={{ marginTop: 2 }}>
            Paires d'aliments qui reviennent dans une même requête (même repas saisi), classées par nombre de fois
            mangées ensemble.
          </p>
          <FoodPairsPanel entries={freqEntries} range={range} />
        </>
      )}
      {mode === 'nutriment' && (
        <>
          <p className="small" style={{ marginTop: 2 }}>
            Choisissez un nutriment : voici les aliments qui vous l'apportent le plus sur la période, et à quel point.
            Cliquez-en un pour voir son apport jour par jour.
          </p>
          <NutrientContributorsPanel entries={freqEntries} range={range} days={days} gran={gran} />
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
  gran,
}: {
  entries: JournalEntry[];
  range: { start: string; end: string };
  days: number;
  foods: Food[];
  gran: Granularity;
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
            data-tip={m.hint}
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
                <span className="cov-label" data-tip={f.nom}>
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

      {open && <FrequencyDetail f={open} entries={entries} range={range} days={days} gran={gran} />}

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
          <span className="cov-label" data-tip={`${p.nomA} + ${p.nomB}`}>
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

// ---------------------------------------------------------------------------
// Mode « Par nutriment » : d'où vient mon fer ? (contributions sur la période)
// ---------------------------------------------------------------------------

const CONTRIB_TOP_N = 12;

/** Valeur d'un nutriment : 1 décimale sous 10, entier au-delà (comme Stats). */
function fmtVal(v: number): string {
  return fmt(v, v < 10 ? 1 : 0);
}

function nutrientLabel(key: NutrientKey, targetByKey: Map<NutrientKey, Target>): string {
  return targetByKey.get(key)?.label ?? EXTRA_NUTRIENT_META[key]?.label ?? key;
}

function nutrientUnit(key: NutrientKey, targetByKey: Map<NutrientKey, Target>): string {
  return targetByKey.get(key)?.unit ?? EXTRA_NUTRIENT_META[key]?.unit ?? '';
}

/** Contexte de lecture partagé par les lignes et l'info-bulle. */
interface ContribCtx {
  unit: string;
  /** Apport total, tous aliments confondus (dénominateur des parts). */
  grandTotal: number;
  /** Jours enregistrés servant de base aux moyennes par jour. */
  recordedDays: number;
  target: Target | null;
}

/** Info-bulle riche d'un aliment contributeur. */
function ContributionCard({ c, ctx }: { c: NutrientContribution; ctx: ContribCtx }) {
  const part = ctx.grandTotal > 0 ? (c.total / ctx.grandTotal) * 100 : 0;
  const perDay = c.total / Math.max(1, ctx.recordedDays);
  const pctOptimal = ctx.target && ctx.target.optimal > 0 ? (perDay / ctx.target.optimal) * 100 : null;
  return (
    <div style={{ maxWidth: 250 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <strong>{c.nom}</strong>
        <span className="hc-badge" style={{ background: 'rgba(255,159,67,0.18)', color: 'var(--accent)' }}>
          {fmt(part)} %
        </span>
      </div>
      <div className="hc-rows" style={{ marginTop: 8 }}>
        <div><span>Apporté sur la période</span><span className="mono">{fmtVal(c.total)} {ctx.unit}</span></div>
        <div><span>Soit par jour</span><span className="mono">{fmtVal(perDay)} {ctx.unit}/j</span></div>
        {pctOptimal !== null && (
          <div>
            <span>De l'optimal/j</span>
            <span className="mono">{fmt(pctOptimal)} %</span>
          </div>
        )}
        {c.grammes > 0 && (
          <div><span>Quantité mangée</span><span className="mono">{fmt(c.grammes)} g</span></div>
        )}
        <div><span>Consommé</span><span className="mono">{fmt(c.occurrences)}× · {fmt(c.jours)} j</span></div>
        <div><span>Dernière fois</span><span className="mono">{dayLabel(c.derniere)}</span></div>
      </div>
      <div className="small" style={{ marginTop: 8, color: 'var(--accent)' }}>Cliquez pour voir le détail par jour</div>
    </div>
  );
}

/**
 * Classement des aliments qui apportent le plus d'un nutriment choisi, sur la
 * période. La barre porte la PART du total (relative au premier, pour rester
 * lisible quand personne ne dépasse 30 %) ; les chiffres donnent la part exacte
 * et la quantité cumulée. Répond à « d'où vient mon fer ? » et, pour les
 * nutriments à limiter, à « qui fait exploser mon sodium ? ».
 */
function NutrientContributorsPanel({
  entries,
  range,
  days,
  gran,
}: {
  entries: JournalEntry[];
  range: { start: string; end: string };
  days: number;
  gran: Granularity;
}) {
  const sunExposures = useStore((s) => s.sunExposures);
  const [nutrient, setNutrient] = useState<NutrientKey>('fer');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [tip, setTip] = useState<{ c: NutrientContribution; x: number; y: number } | null>(null);

  const targets = useTargets();
  const targetByKey = useMemo(() => new Map(targets.map((t) => [t.key, t])), [targets]);
  const target = targetByKey.get(nutrient) ?? null;
  const unit = nutrientUnit(nutrient, targetByKey);
  const label = nutrientLabel(nutrient, targetByKey);

  /** Jours réellement enregistrés dans la plage : base honnête des moyennes/j. */
  const recordedDays = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.date >= range.start && e.date <= range.end && e.items.length > 0) set.add(e.date);
    }
    return set.size;
  }, [entries, range]);

  const contributions = useMemo(() => {
    const list = nutrientContributions(entries, range, nutrient);
    if (nutrient !== 'vitD') return list;
    // Le soleil compte comme un apport de vitamine D (comme l'onglet Jour et les
    // moyennes de Stats) : sans lui, le classement laisse croire à un manque.
    const parDate = new Map<string, number>();
    let total = 0;
    for (const d of datesInRange(range)) {
      const v = sunVitDForDate(sunExposures, d);
      if (v <= 0) continue;
      parDate.set(d, v);
      total += v;
    }
    if (total <= 0) return list;
    const dates = [...parDate.keys()].sort();
    const sun: NutrientContribution = {
      key: 'sun',
      foodId: null,
      nom: '☀️ Soleil (exposition)',
      total,
      occurrences: parDate.size,
      jours: parDate.size,
      grammes: 0,
      derniere: dates[dates.length - 1],
      parDate,
    };
    return [...list, sun].sort((a, b) => b.total - a.total);
  }, [entries, range, nutrient, sunExposures]);

  const grandTotal = contributions.reduce((a, c) => a + c.total, 0);
  const maxTotal = contributions.length > 0 ? contributions[0].total : 0;
  const shown = showAll ? contributions : contributions.slice(0, CONTRIB_TOP_N);
  const open = openKey ? contributions.find((c) => c.key === openKey) ?? null : null;

  /** Concentration de l'apport : part des 5 premiers, et combien pour atteindre 80 %. */
  const { topFivePct, nFor80 } = useMemo(() => {
    let cum = 0;
    let n80 = 0;
    for (const c of contributions) {
      cum += c.total;
      n80++;
      if (grandTotal > 0 && cum >= 0.8 * grandTotal) break;
    }
    const five = contributions.slice(0, 5).reduce((a, c) => a + c.total, 0);
    return { topFivePct: grandTotal > 0 ? (five / grandTotal) * 100 : 0, nFor80: n80 };
  }, [contributions, grandTotal]);

  const perDay = grandTotal / Math.max(1, recordedDays);
  const pctOptimal = target && target.optimal > 0 ? (perDay / target.optimal) * 100 : null;
  const isLimit = target?.goal === 'limit';
  const ctx: ContribCtx = { unit, grandTotal, recordedDays, target };

  function selectNutrient(k: NutrientKey) {
    setNutrient(k);
    setOpenKey(null);
    setShowAll(false);
  }

  return (
    <>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select
          value={nutrient}
          onChange={(e) => selectNutrient(e.target.value as NutrientKey)}
          aria-label="Nutriment analysé"
        >
          {NUTRIENT_GROUPS.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.keys.map((k) => (
                <option key={k} value={k}>
                  {nutrientLabel(k, targetByKey)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {target && <span className="small">{target.role}</span>}
      </div>

      {contributions.length === 0 || grandTotal <= 0 ? (
        <div className="empty">Aucun apport de {label} enregistré sur cette période.</div>
      ) : (
        <>
          <div className="hint" style={{ marginTop: 0 }}>
            <strong>{fmtVal(grandTotal)} {unit}</strong> au total sur la période, soit{' '}
            <strong>{fmtVal(perDay)} {unit}/j</strong> sur {fmt(recordedDays)} jour(s) enregistré(s) ({fmt(days)} j de
            période)
            {pctOptimal !== null && (
              <>
                {' '}— {fmt(pctOptimal)} % de l'optimal ({fmt(target!.optimal)} {unit}/j)
              </>
            )}
            .{' '}
            {contributions.length >= 5 && (
              <>
                Les 5 premiers aliments fournissent {fmt(topFivePct)} % du total ; il en faut {fmt(nFor80)} pour
                atteindre 80 %.
              </>
            )}
            {isLimit && ' Ici, être en tête n’est pas une bonne nouvelle : ce sont les principaux apporteurs de ce que vous cherchez à limiter.'}
            {nutrient === 'vitD' && ' ☀️ L’exposition au soleil est comptée comme un apport.'}
          </div>

          {shown.map((c) => {
            const part = (c.total / grandTotal) * 100;
            return (
              <div
                className={`cov-row${openKey === c.key ? ' sel' : ''}`}
                key={c.key}
                onClick={() => setOpenKey((prev) => (prev === c.key ? null : c.key))}
                onMouseMove={(e) => setTip({ c, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTip((prev) => (prev?.c.key === c.key ? null : prev))}
              >
                <span className="cov-label" data-tip={c.nom}>
                  {openKey === c.key && <span style={{ color: 'var(--accent)' }}>● </span>}
                  {c.nom}
                </span>
                <div className={`bar${isLimit ? ' over' : ''}`}>
                  <span style={{ width: `${maxTotal > 0 ? (c.total / maxTotal) * 100 : 0}%` }} />
                </div>
                <span className="mono small" style={{ textAlign: 'right' }}>
                  {fmt(part)} % · {fmtVal(c.total)} {unit}
                </span>
              </div>
            );
          })}

          {contributions.length > CONTRIB_TOP_N && (
            <button className="ghost small" style={{ marginTop: 4 }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? '− Réduire' : `+ Voir les ${contributions.length - CONTRIB_TOP_N} autre(s)`}
            </button>
          )}

          {open && <ContributionDetail c={open} ctx={ctx} range={range} gran={gran} />}

          {tip && (
            <FollowTip x={tip.x} y={tip.y}>
              <ContributionCard c={tip.c} ctx={ctx} />
            </FollowTip>
          )}
        </>
      )}
    </>
  );
}

/**
 * Barres « une par pas de temps » sur toute la période : chaque barre somme les
 * valeurs des dates de son groupe (un jour, une semaine ou un mois). Les groupes
 * couvrent TOUTE la plage — les vides restent des trous, ce qui garde l'axe
 * régulier et rend les creux visibles. Partagé par les deux détails.
 */
function PeriodBars({
  buckets,
  valueOf,
  format,
  range,
}: {
  buckets: DateBucket[];
  /** Valeur d'une date (0 si aucune). */
  valueOf: (date: string) => number;
  /** Formatage de la valeur d'un groupe dans l'info-bulle. */
  format: (v: number) => string;
  range: { start: string; end: string };
}) {
  const values = buckets.map((b) => b.dates.reduce((a, d) => a + valueOf(d), 0));
  const maxVal = Math.max(1, ...values);

  const W = 720;
  const H = 90;
  const padX = 4;
  const padBottom = 18;
  const scale = scaleLinear().domain([0, Math.max(1, buckets.length - 1)]).range([padX, W - padX]);
  // Un seul groupe (ex. « Mois » sur 30 jours) : au centre plutôt que collé à gauche.
  const x = buckets.length === 1 ? () => W / 2 : scale;
  const barW = Math.max(2, Math.min(14, (W - 2 * padX) / Math.max(1, buckets.length) - 2));

  const [hover, setHover] = useState<{ label: string; v: number; px: number } | null>(null);

  return (
    <>
      <div style={{ position: 'relative' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img">
          <line x1={padX} y1={H - padBottom} x2={W - padX} y2={H - padBottom} stroke={C.border} strokeWidth={1} />
          {buckets.map((b, i) => {
            const v = values[i];
            if (v <= 0) return null;
            const h = ((H - padBottom - 8) * v) / maxVal;
            return (
              <rect
                key={b.key}
                x={x(i) - barW / 2}
                y={H - padBottom - h}
                width={barW}
                height={h}
                rx={2}
                fill={C.accent}
                onMouseEnter={() => setHover({ label: b.label, v, px: (x(i) / W) * 100 })}
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
            {hover.label} · {format(hover.v)}
          </div>
        )}
      </div>
      <div className="row small" style={{ justifyContent: 'space-between', opacity: 0.7 }}>
        <span>{dayLabel(range.start)}</span>
        <span>{dayLabel(range.end)}</span>
      </div>
    </>
  );
}

/** Détail d'un contributeur : ce qu'il a apporté, pas de temps par pas de temps. */
function ContributionDetail({
  c,
  ctx,
  range,
  gran,
}: {
  c: NutrientContribution;
  ctx: ContribCtx;
  range: { start: string; end: string };
  gran: Granularity;
}) {
  const buckets = useMemo(() => groupDates(datesInRange(range), gran), [range, gran]);
  const perDay = c.total / Math.max(1, ctx.recordedDays);
  const pctOptimal = ctx.target && ctx.target.optimal > 0 ? (perDay / ctx.target.optimal) * 100 : null;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong>{c.nom}</strong>
        <span className="small mono">
          {fmtVal(c.total)} {ctx.unit} · {fmtVal(perDay)} {ctx.unit}/j
          {pctOptimal !== null && ` · ${fmt(pctOptimal)} % de l'optimal`}
        </span>
      </div>
      <p className="small" style={{ margin: '4px 0 8px' }}>
        Ce que cet aliment a apporté {gran === 'jour' ? 'chaque jour' : gran === 'semaine' ? 'chaque semaine' : 'chaque mois'} (
        {fmt(c.jours)} jour(s) d'apport ; la moyenne par jour est lissée sur tous les jours enregistrés, y compris ceux
        sans cet aliment).
      </p>
      <PeriodBars
        buckets={buckets}
        valueOf={(d) => c.parDate.get(d) ?? 0}
        format={(v) => `${fmtVal(v)} ${ctx.unit}`}
        range={range}
      />
    </div>
  );
}

/** Détail « quand ai-je mangé ça ? » : une marque par pas de temps de la période. */
function FrequencyDetail({
  f,
  entries,
  range,
  days,
  gran,
}: {
  f: FoodFrequency;
  entries: JournalEntry[];
  range: { start: string; end: string };
  days: number;
  gran: Granularity;
}) {
  const counts = useMemo(() => occurrencesByDate(f, entries), [f, entries]);
  const buckets = useMemo(() => groupDates(datesInRange(range), gran), [range, gran]);

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong>{f.nom}</strong>
        <span className="small mono">
          {fmt(f.occurrences)} fois · {fmt(f.jours)} jour(s) sur {fmt(days)} · dernière fois {dayLabel(f.derniere)}
        </span>
      </div>
      <p className="small" style={{ margin: '4px 0 8px' }}>
        Une barre par {gran === 'jour' ? 'jour de consommation' : gran === 'semaine' ? 'semaine' : 'mois'} (
        {fmt(f.jours)} jour(s) sur {fmt(days)}, soit en moyenne{' '}
        {f.jours > 0 ? `1 fois tous les ${fmt(days / f.jours, 1)} jours` : 'jamais'}).
      </p>
      <PeriodBars
        buckets={buckets}
        valueOf={(d) => counts.get(d) ?? 0}
        format={(v) => `${fmt(v)}×`}
        range={range}
      />
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
