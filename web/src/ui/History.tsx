import { useEffect, useMemo, useState } from 'react';
import { useStore, todayStr, useEffectiveFoods, isDayCounted } from '../store/store';
import { computeTargets } from '../nutrition/targets';
import { foodFrequencies, frequencyKey } from '../nutrition/frequency';
import type { FoodFrequency } from '../nutrition/frequency';
import { matchFood } from '../nutrition/match';
import { normalizeForMatch } from '../nutrition/normalize';
import { dayKcalUncertainty } from '../nutrition/uncertainty';
import { categorizeNames } from '../extraction/categorize';
import type { FoodCategory } from '../nutrition/types';
import { Capture } from './Capture';
import { EntryCard } from './EntryCard';
import { ManualAdd } from './ManualAdd';
import { Sun } from './Sun';
import { DayNote } from './DayNote';
import { UncertaintyBadge } from './UncertaintyBadge';
import { fmt, CATEGORY_LABELS } from './format';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/** Date locale N jours avant aujourd'hui. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayStr(d);
}

function dayLabel(date: string, short = false): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(
    'fr-FR',
    short ? { day: 'numeric', month: 'short' } : { weekday: 'long', day: 'numeric', month: 'long' },
  );
}

/**
 * Onglet Historique : calendrier mensuel navigable. Chaque jour rempli montre ses
 * calories et un repère de couverture vs objectif. Clic sur un jour (rempli ou vide)
 * = éditer ce jour (corriger, ajouter un oubli, saisir un jour passé). Les analyses
 * poussées (tendances, moyennes) sont dans l'onglet Stats.
 */
export function History() {
  const entries = useStore((s) => s.entries);
  const profile = useStore((s) => s.profile);
  const mutedDays = useStore((s) => s.mutedDays);
  const dayNotes = useStore((s) => s.dayNotes);
  const toggleDayMute = useStore((s) => s.toggleDayMute);
  const targets = useMemo(() => computeTargets(profile), [profile]);
  const kcalTarget = targets.find((t) => t.key === 'kcal')?.optimal ?? 2000;

  const today = todayStr();
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [editDate, setEditDate] = useState<string | null>(null);
  /** Jours mis en évidence par la recherche d'aliment (« quand ai-je mangé du saumon ? »). */
  const [foundDates, setFoundDates] = useState<Set<string>>(new Set());

  /** Ouvre un jour trouvé par la recherche, en basculant le calendrier sur son mois. */
  function goToDate(date: string) {
    setYm({ y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) - 1 });
    setEditDate(date);
  }

  /** Totaux kcal par jour (tout l'historique). */
  const kcalByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      const kcal = e.items.reduce((a, it) => a + it.nutrients.kcal, 0);
      map.set(e.date, (map.get(e.date) ?? 0) + kcal);
    }
    return map;
  }, [entries]);

  const recordedCount = kcalByDate.size;

  /** Cases du mois affiché (vides en tête pour aligner sur le bon jour de semaine). */
  const cells = useMemo(() => {
    const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
    const leading = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7; // lundi = 0
    const out: (string | null)[] = Array(leading).fill(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(todayStr(new Date(ym.y, ym.m, d)));
    return out;
  }, [ym]);

  const monthLabel = new Date(ym.y, ym.m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  const isCurrentMonth = ym.y === now.getFullYear() && ym.m === now.getMonth();

  const shift = (delta: number) =>
    setYm(({ y, m }) => {
      const d = new Date(y, m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });

  return (
    <>
      <FoodSearch onDatesChange={setFoundDates} onPickDate={goToDate} />

      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="ghost" onClick={() => shift(-1)} aria-label="Mois précédent">
            ‹
          </button>
          <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{monthLabel}</h2>
          <button className="ghost" onClick={() => shift(1)} disabled={isCurrentMonth} aria-label="Mois suivant">
            ›
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          {recordedCount} jour(s) enregistré(s) au total. Cliquez un jour pour le consulter ou le modifier (ajouter un
          oubli, corriger…). Les tendances et moyennes sont dans « Stats ».
        </div>

        <div className="cal-grid cal-head">
          {WEEKDAYS.map((w, i) => (
            <div className="cal-weekday" key={i}>
              {w}
            </div>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((date, i) => {
            if (date === null) return <div key={`e${i}`} className="cal-cell empty" />;
            const hasEntries = kcalByDate.has(date);
            const counted = isDayCounted(mutedDays, hasEntries, date);
            return (
              <CalCell
                key={date}
                date={date}
                kcal={kcalByDate.get(date)}
                target={kcalTarget}
                isToday={date === today}
                isFuture={date > today}
                selected={date === editDate}
                found={foundDates.has(date)}
                hasNote={!!dayNotes[date]}
                muted={hasEntries && !counted}
                fasting={!hasEntries && counted}
                counted={counted}
                onClick={() => setEditDate(date)}
                onToggleMute={() => toggleDayMute(date)}
              />
            );
          })}
        </div>
        <div className="row small" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <span>
            <i className="cal-legend under" /> sous l'objectif
          </span>
          <span>
            <i className="cal-legend ok" /> proche de l'objectif
          </span>
          <span>
            <i className="cal-legend over" /> au-dessus
          </span>
          <span>
            <i className="cal-legend muted" /> non compté (mal rempli)
          </span>
          <span>
            <i className="cal-legend fasting" /> jeûne (compté 0)
          </span>
          <span>📝 note ce jour</span>
          {foundDates.size > 0 && (
            <span>
              <i className="cal-legend found" /> jour retenu par la recherche
            </span>
          )}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Astuce : 🔇 sur une case exclut ce jour des moyennes (jour mal rempli) ; sur un jour vide, le marque comme
          jeûne (compté comme 0). Les jours vides « normaux » ne comptent pas.
        </div>
      </div>

      {editDate && <DayEditor date={editDate} onChangeDate={setEditDate} onClose={() => setEditDate(null)} />}
    </>
  );
}

/** Une case-jour du calendrier. */
function CalCell({
  date,
  kcal,
  target,
  isToday,
  isFuture,
  selected,
  found,
  hasNote,
  muted,
  fasting,
  counted,
  onClick,
  onToggleMute,
}: {
  date: string;
  kcal: number | undefined;
  target: number;
  isToday: boolean;
  isFuture: boolean;
  selected: boolean;
  /** Jour contenant l'aliment recherché (mis en évidence). */
  found: boolean;
  /** Jour portant une note libre (pastille 📝). */
  hasNote: boolean;
  /** Jour rempli mais exclu des moyennes (mal rempli). */
  muted: boolean;
  /** Jour vide marqué comme jeûne (compté comme 0). */
  fasting: boolean;
  /** Jour actuellement compté dans les moyennes. */
  counted: boolean;
  onClick: () => void;
  onToggleMute: () => void;
}) {
  const day = Number(date.slice(8, 10));
  const ratio = kcal != null && target > 0 ? kcal / target : 0;
  const level = kcal == null ? '' : ratio < 0.7 ? 'under' : ratio <= 1.1 ? 'ok' : 'over';

  // Libellé de l'action de mute selon l'état courant du jour.
  const muteTitle = counted
    ? 'Ne pas compter ce jour dans les moyennes'
    : muted
      ? 'Recompter ce jour dans les moyennes'
      : 'Marquer comme jeûne (compté comme 0)';

  return (
    <button
      className={`cal-cell${isToday ? ' today' : ''}${selected ? ' selected' : ''}${isFuture ? ' future' : ''}${
        kcal != null ? ' filled' : ''
      }${found ? ' found' : ''}${muted ? ' muted' : ''}${fasting ? ' fasting' : ''}`}
      onClick={onClick}
      disabled={isFuture}
      data-tip={found ? 'Jour retenu par la recherche' : undefined}
    >
      <span className="cal-day">{day}</span>
      {hasNote && <span className="cal-note" aria-label="Note ce jour" data-tip="Note ce jour">📝</span>}
      {!isFuture && (
        <span
          className="cal-mute"
          role="button"
          tabIndex={-1}
          aria-label={muteTitle}
          data-tip={muteTitle}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMute();
          }}
        >
          {counted ? '🔇' : '🔊'}
        </span>
      )}
      {kcal != null && (
        <>
          <span className="cal-kcal">{fmt(kcal)}</span>
          <span className={`cal-bar ${level}`}>
            <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
        </>
      )}
      {fasting && <span className="cal-fasting-tag">jeûne</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Recherche d'un aliment dans l'historique
// ---------------------------------------------------------------------------

/** Nombre de jours affichés d'emblée dans les résultats (le reste au clic). */
const DATES_SHOWN = 12;
/** Nombre d'aliments proposés d'emblée (une catégorie entière en compte beaucoup). */
const RESULTS_SHOWN = 16;

/**
 * « Quand ai-je mangé du saumon ? » : cherche des aliments dans tout l'historique
 * et répond par leur fréquence et la liste des jours, cliquables (le calendrier
 * bascule sur le mois du jour choisi et l'ouvre). Les jours trouvés sont aussi
 * mis en évidence dans le calendrier.
 *
 * La recherche porte sur le NOM, sur la CATÉGORIE (« tous les poissons »), ou sur
 * les deux, et plusieurs aliments peuvent rester sélectionnés à la fois :
 *  - « au moins un » (OU) — la question habituelle (« quand ai-je mangé du poisson ? ») ;
 *  - « tous » (ET) — les jours où deux aliments se retrouvent ensemble.
 * Par défaut tous les résultats sont actifs : le filtre par catégorie répond donc
 * tout de suite, sans avoir à cocher les aliments un par un.
 */
function FoodSearch({
  onDatesChange,
  onPickDate,
}: {
  onDatesChange: (dates: Set<string>) => void;
  onPickDate: (date: string) => void;
}) {
  const entries = useStore((s) => s.entries);
  const foods = useEffectiveFoods();
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<FoodCategory | 'all' | 'none'>('all');
  /** Aliments cochés ; `null` = tous les résultats courants (état de départ). */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [combine, setCombine] = useState<'ou' | 'et'>('ou');
  const [showAllDates, setShowAllDates] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);

  const today = todayStr();
  const categoryOfFood = useMemo(() => {
    const byId = new Map(foods.map((f) => [f.id, f.categorie]));
    return (id: string) => byId.get(id);
  }, [foods]);
  /** Fréquences sur TOUT l'historique (la recherche n'est pas bornée à une période). */
  const freqs = useMemo(
    () => foodFrequencies(entries, { start: '0000-01-01', end: today }, categoryOfFood),
    [entries, today, categoryOfFood],
  );

  /**
   * Résultats : filtre par catégorie, puis recoupement direct sur le libellé
   * (« saumon » → « Saumon (cuit) », « Saumon fumé »), complété par le matching
   * flou de l'app quand rien ne ressort (fautes de frappe, alias : « pavé de
   * saumon » → aliment `saumon`). Sans texte ET sans catégorie : aucun résultat,
   * on n'affiche pas tout l'historique par accident.
   */
  const results = useMemo<FoodFrequency[]>(() => {
    const base =
      cat === 'all' ? freqs : cat === 'none' ? freqs.filter((f) => f.categorie === null) : freqs.filter((f) => f.categorie === cat);
    const q = normalizeForMatch(query.trim());
    if (q.length < 2) return cat === 'all' ? [] : base;
    const direct = base.filter((f) => normalizeForMatch(f.nom).includes(q));
    if (direct.length > 0) return direct;
    const m = matchFood(query, foods);
    if (!m.food) return [];
    return base.filter((f) => f.key === frequencyKey(m.food!.id, m.food!.nom));
  }, [query, cat, freqs, foods]);

  // Changer de recherche repart de « tout sélectionné » : garder les coches
  // d'une recherche précédente n'aurait aucun sens sur de nouveaux aliments.
  useEffect(() => {
    setPicked(null);
    setShowAllDates(false);
    setShowAllResults(false);
  }, [query, cat]);

  const active = picked ? results.filter((f) => picked.has(f.key)) : results;

  /** Jours retenus : union (OU) ou intersection (ET) des jours des aliments actifs. */
  const dates = useMemo(() => {
    if (active.length === 0) return [];
    if (combine === 'et') {
      let acc = active[0].dates;
      for (const f of active.slice(1)) {
        const other = new Set(f.dates);
        acc = acc.filter((d) => other.has(d));
      }
      return [...acc].sort();
    }
    const union = new Set<string>();
    for (const f of active) for (const d of f.dates) union.add(d);
    return [...union].sort();
  }, [active, combine]);

  // Le surlignage du calendrier (état du parent) suit les jours retenus. En effet
  // et non pendant le rendu : remonter l'info au parent est un effet de bord.
  // La clé texte évite de relancer l'effet à chaque rendu (le tableau est neuf).
  const datesKey = dates.join(',');
  useEffect(() => {
    onDatesChange(new Set(datesKey ? datesKey.split(',') : []));
  }, [datesKey, onDatesChange]);

  const shownResults = showAllResults ? results : results.slice(0, RESULTS_SHOWN);
  const shownDates = showAllDates ? [...dates].reverse() : [...dates].reverse().slice(0, DATES_SHOWN);
  const searching = query.trim().length >= 2 || cat !== 'all';

  function toggle(key: string) {
    const current = picked ?? new Set(results.map((f) => f.key));
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPicked(next);
    setShowAllDates(false);
  }

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un aliment… (« saumon » : quand en ai-je mangé ?)"
          style={{ flex: '1 1 240px' }}
          aria-label="Rechercher un aliment dans l'historique"
        />
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value as FoodCategory | 'all' | 'none')}
          aria-label="Filtrer par catégorie"
          style={{ flex: '0 1 180px' }}
        >
          <option value="all">Toutes catégories</option>
          {CATEGORY_LABELS.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
          <option value="none">Non classés</option>
        </select>
        {(query || cat !== 'all') && (
          <button className="ghost small" onClick={() => { setQuery(''); setCat('all'); }}>
            Effacer
          </button>
        )}
      </div>

      <UnclassifiedFoods freqs={freqs} />

      {searching && results.length === 0 && (
        <div className="hint">Aucun aliment ne correspond dans l'historique.</div>
      )}

      {results.length > 1 && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            {shownResults.map((f) => (
              <button
                key={f.key}
                className={`small ${active.includes(f) ? 'chip-active' : 'ghost'}`}
                onClick={() => toggle(f.key)}
                data-tip={active.includes(f) ? 'Retirer de la sélection' : 'Ajouter à la sélection'}
              >
                {f.nom} · {fmt(f.occurrences)}×
              </button>
            ))}
            {!showAllResults && results.length > RESULTS_SHOWN && (
              <button className="ghost small" onClick={() => setShowAllResults(true)}>
                +{results.length - RESULTS_SHOWN} autre(s)
              </button>
            )}
          </div>
          <div className="row small" style={{ gap: 10, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
            <span style={{ color: 'var(--muted)' }}>
              {active.length} / {results.length} sélectionné(s)
            </span>
            <button className="ghost small" onClick={() => setPicked(null)} disabled={picked === null}>
              Tout
            </button>
            <button className="ghost small" onClick={() => setPicked(new Set())} disabled={active.length === 0}>
              Aucun
            </button>
            {active.length > 1 && (
              <label className="row small" style={{ gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={combine === 'et'}
                  onChange={(e) => setCombine(e.target.checked ? 'et' : 'ou')}
                />
                <span data-tip="Coché : seuls les jours où TOUS les aliments sélectionnés apparaissent">
                  jours contenant <strong>tous</strong> les aliments
                </span>
              </label>
            )}
          </div>
        </>
      )}

      {active.length > 0 && (
        <>
          <div className="hint" style={{ marginTop: 8 }}>
            {active.length === 1 ? (
              <>
                <strong>{active[0].nom}</strong> : {fmt(active[0].occurrences)} fois sur {fmt(active[0].jours)} jour(s) —
                dernière fois <strong>{dayLabel(active[0].derniere, true)}</strong> (
                {daysSince(active[0].derniere, today)}). Total {fmt(active[0].grammes)} g · {fmt(active[0].kcal)} kcal.
              </>
            ) : (
              <>
                <strong>{active.length} aliments</strong> ·{' '}
                {fmt(active.reduce((a, f) => a + f.occurrences, 0))} consommations sur <strong>{dates.length}</strong>{' '}
                jour(s) {combine === 'et' ? 'où ils apparaissent tous' : 'où au moins un apparaît'} · total{' '}
                {fmt(active.reduce((a, f) => a + f.kcal, 0))} kcal.
              </>
            )}{' '}
            Les jours concernés sont surlignés dans le calendrier.
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {shownDates.map((d) => (
              <button key={d} className="ghost small" onClick={() => onPickDate(d)} data-tip="Ouvrir ce jour">
                {dayLabel(d, true)}
              </button>
            ))}
            {!showAllDates && dates.length > DATES_SHOWN && (
              <button className="ghost small" onClick={() => setShowAllDates(true)}>
                +{dates.length - DATES_SHOWN} autre(s)
              </button>
            )}
            {dates.length === 0 && <span className="small">Aucun jour ne contient tous ces aliments.</span>}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Rattrapage des aliments non classés : les plats décrits par le LLM avant que
 * l'app ne conserve leur catégorie n'en ont aucune, et échapperaient donc au
 * filtre par catégorie (« poissons » raterait les sardines à l'huile). Un appel
 * IA groupé les classe tous d'un coup, une fois pour toutes.
 */
function UnclassifiedFoods({ freqs }: { freqs: FoodFrequency[] }) {
  const extractionMode = useStore((s) => s.extractionMode);
  const cloudApiKey = useStore((s) => s.cloudApiKey);
  const cloudModel = useStore((s) => s.cloudModel);
  const setItemCategories = useStore((s) => s.setItemCategories);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const unclassified = useMemo(() => freqs.filter((f) => f.categorie === null), [freqs]);
  if (unclassified.length === 0) return status ? <div className="status">{status}</div> : null;

  async function classify() {
    setBusy(true);
    setStatus('Classement en cours…');
    try {
      const byName = await categorizeNames(
        unclassified.map((f) => f.nom),
        extractionMode,
        cloudApiKey,
        cloudModel,
      );
      const n = setItemCategories(byName);
      setStatus(n > 0 ? `${n} aliment(s) classés dans l'historique.` : 'Aucun aliment classé.');
    } catch (e) {
      setStatus(`Erreur : ${(e as Error).message}`);
    }
    setBusy(false);
  }

  return (
    <div className="row small" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      <span style={{ color: 'var(--muted)' }}>
        {unclassified.length} aliment(s) sans catégorie (estimés par l'IA) — invisibles au filtre par catégorie.
      </span>
      <button className="ghost small" onClick={classify} disabled={busy}>
        {busy ? '…' : '⟳ Les classer avec l’IA'}
      </button>
      {status && <span style={{ color: 'var(--muted)' }}>{status}</span>}
    </div>
  );
}

/** « il y a 3 jours », « aujourd'hui » — lisible dans le résumé de recherche. */
function daysSince(date: string, today: string): string {
  const diff = Math.round(
    (new Date(`${today}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000,
  );
  if (diff <= 0) return "aujourd'hui";
  if (diff === 1) return 'hier';
  return `il y a ${diff} jours`;
}

// ---------------------------------------------------------------------------
// Édition d'un jour
// ---------------------------------------------------------------------------

function DayEditor({
  date,
  onChangeDate,
  onClose,
}: {
  date: string;
  onChangeDate: (d: string) => void;
  onClose: () => void;
}) {
  const entries = useStore((s) => s.entries);
  const duplicateDay = useStore((s) => s.duplicateDay);
  const mutedDays = useStore((s) => s.mutedDays);
  const toggleDayMute = useStore((s) => s.toggleDayMute);
  const [flash, setFlash] = useState('');
  const today = todayStr();
  const dayEntries = entries.filter((e) => e.date === date).sort((a, b) => b.createdAt - a.createdAt);
  const kcal = dayEntries.reduce((a, e) => a + e.items.reduce((b, it) => b + it.nutrients.kcal, 0), 0);
  const kcalUnc = dayKcalUncertainty(dayEntries);
  const hasEntries = dayEntries.length > 0;
  const counted = isDayCounted(mutedDays, hasEntries, date);

  return (
    <div className="panel" style={{ borderLeft: '3px solid var(--accent)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, textTransform: 'capitalize' }}>{dayLabel(date)}</h2>
        <button className="ghost small" onClick={onClose}>
          Fermer
        </button>
      </div>

      <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
        <label className="field">
          Jour
          <input type="date" value={date} max={today} onChange={(e) => e.target.value && onChangeDate(e.target.value)} />
        </label>
        <button className="ghost small" onClick={() => onChangeDate(daysAgo(1))}>
          Hier
        </button>
        <button className="ghost small" onClick={() => onChangeDate(daysAgo(2))}>
          Avant-hier
        </button>
        {date !== today && dayEntries.length > 0 && (
          <button
            className="ghost small"
            data-tip="Recopie toutes les entrées de ce jour sur aujourd'hui (journées qui se ressemblent)"
            onClick={() => {
              duplicateDay(date);
              setFlash(`Journée du ${dayLabel(date, true)} dupliquée sur aujourd'hui (${dayEntries.length} repas).`);
            }}
          >
            ⧉ Dupliquer ce jour → aujourd'hui
          </button>
        )}
        <span className="small mono" style={{ marginLeft: 'auto' }}>
          {fmt(kcal)} kcal ce jour
          <UncertaintyBadge kcal={kcal} unc={kcalUnc} />
        </span>
      </div>
      <div className="hint">
        « Modifier » sur une entrée : corriger aliments/quantités, ou changer sa date si elle a été saisie le mauvais
        jour. « ⧉ Auj. » sur une entrée recopie ce repas sur aujourd'hui. L'ajout ci-dessous enregistre directement
        sur ce jour.
      </div>

      <label className="row small" style={{ gap: 8, alignItems: 'center', cursor: 'pointer', marginTop: 4 }}>
        <input type="checkbox" checked={!counted} onChange={() => toggleDayMute(date)} />
        {hasEntries
          ? 'Ne pas compter ce jour dans les moyennes (jour mal rempli)'
          : 'Jeûne ce jour — le compter comme une journée à 0'}
      </label>

      {flash && <div className="status">{flash}</div>}

      <DayNote key={date} date={date} />

      {dayEntries.length === 0 ? (
        <div className="empty">Aucune entrée ce jour — ajoutez ce que vous avez mangé ci-dessous.</div>
      ) : (
        dayEntries.map((e) => <EntryCard key={e.id} entry={e} />)
      )}

      <Capture date={date} title={`Dicter, taper ou photographier un repas du ${dayLabel(date, true)}`} />
      <ManualAdd date={date} title={`Ajouter un aliment au ${dayLabel(date, true)}`} />
      <Sun date={date} />
    </div>
  );
}
