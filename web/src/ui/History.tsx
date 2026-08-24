import { useEffect, useMemo, useState } from 'react';
import { useStore, todayStr, useEffectiveFoods, isDayCounted } from '../store/store';
import { useTargets } from './useTargets';
import { foodFrequencies, frequencyKey } from '../nutrition/frequency';
import type { FoodFrequency } from '../nutrition/frequency';
import { matchFood } from '../nutrition/match';
import { normalizeForMatch } from '../nutrition/normalize';
import { dayKcalUncertainty } from '../nutrition/uncertainty';
import { categorizeNames } from '../extraction/categorize';
import type { Food, FoodCategory } from '../nutrition/types';
import { DayView } from './DayView';
import { DayPickerButton, dayLabel, daysAgo, relativeDayLabel } from './DayPicker';
import { HistoryHeatmap } from './HistoryHeatmap';
import { UncertaintyBadge } from './UncertaintyBadge';
import { fmt, CATEGORY_LABELS } from './format';

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

/**
 * Onglet Historique : une heatmap continue (plusieurs mois d'un coup, pour voir
 * la régularité) puis le calendrier mensuel navigable, pour le détail. Chaque
 * jour rempli montre ses calories et un repère de couverture vs objectif. Clic
 * sur un jour (rempli ou vide) = éditer ce jour (corriger, ajouter un oubli,
 * saisir un jour passé). Les analyses poussées (tendances, moyennes) sont dans
 * l'onglet Stats.
 */
export function History() {
  const entries = useStore((s) => s.entries);
  const mutedDays = useStore((s) => s.mutedDays);
  const dayNotes = useStore((s) => s.dayNotes);
  const toggleDayMute = useStore((s) => s.toggleDayMute);
  const targets = useTargets();
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

      <HistoryHeatmap
        kcalByDate={kcalByDate}
        mutedDays={mutedDays}
        kcalTarget={kcalTarget}
        today={today}
        foundDates={foundDates}
        selected={editDate}
        onPickDate={goToDate}
      />

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
 * Filtre les fréquences par catégorie puis par texte : recoupement direct sur
 * le libellé (« saumon » → « Saumon (cuit) », « Saumon fumé »), complété par le
 * matching flou de l'app quand rien ne ressort (fautes de frappe, alias :
 * « pavé de saumon » → aliment `saumon`). Sans texte ET sans catégorie : aucun
 * résultat, on n'affiche pas tout l'historique par accident. Fonction pure
 * (hors composant) : réutilisée aussi pour l'ajout en bloc d'une catégorie.
 */
function filterFoodResults(
  freqs: FoodFrequency[],
  foods: Food[],
  query: string,
  cat: FoodCategory | 'all' | 'none',
): FoodFrequency[] {
  const base =
    cat === 'all' ? freqs : cat === 'none' ? freqs.filter((f) => f.categorie === null) : freqs.filter((f) => f.categorie === cat);
  const q = normalizeForMatch(query.trim());
  if (q.length < 2) return cat === 'all' ? [] : base;
  const direct = base.filter((f) => normalizeForMatch(f.nom).includes(q));
  if (direct.length > 0) return direct;
  const m = matchFood(query, foods);
  if (!m.food) return [];
  return base.filter((f) => f.key === frequencyKey(m.food!.id, m.food!.nom));
}

/**
 * « Quand ai-je mangé du saumon ? » : cherche des aliments dans tout l'historique
 * et répond par leur fréquence et la liste des jours, cliquables (le calendrier
 * bascule sur le mois du jour choisi et l'ouvre). Les jours trouvés sont aussi
 * mis en évidence dans le calendrier.
 *
 * La sélection est un PANIER qui survit aux recherches successives, pas un
 * simple filtre : on cherche « saumon », on clique dessus (il est ajouté), puis
 * on cherche/choisit une autre catégorie ou un autre nom, et ça vient s'ajouter
 * SANS effacer ce qui est déjà là. Deux façons de remplir le panier :
 *  - clic sur un aliment (résultat de la recherche texte, ou navigué par
 *    catégorie) : l'ajoute ou le retire, un par un ;
 *  - choisir une catégorie dans le sélecteur : ajoute D'UN COUP tous ses
 *    aliments (« viande » → tous les aliments viande du panier).
 * Les aliments du panier se combinent en « au moins un » (OU, par défaut) ou
 * « tous » (ET) via la bascule, pour répondre aussi à « saumon ET riz ».
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
  /** Le panier : aliments retenus, accumulés au fil des recherches. */
  const [basket, setBasket] = useState<Set<string>>(new Set());
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

  const results = useMemo(() => filterFoodResults(freqs, foods, query, cat), [freqs, foods, query, cat]);
  const basketItems = useMemo(() => freqs.filter((f) => basket.has(f.key)), [freqs, basket]);

  /** Jours retenus : union (OU) ou intersection (ET) des jours du panier. */
  const dates = useMemo(() => {
    if (basketItems.length === 0) return [];
    if (combine === 'et') {
      let acc = basketItems[0].dates;
      for (const f of basketItems.slice(1)) {
        const other = new Set(f.dates);
        acc = acc.filter((d) => other.has(d));
      }
      return [...acc].sort();
    }
    const union = new Set<string>();
    for (const f of basketItems) for (const d of f.dates) union.add(d);
    return [...union].sort();
  }, [basketItems, combine]);

  // Le surlignage du calendrier (état du parent) suit les jours retenus. En effet
  // et non pendant le rendu : remonter l'info au parent est un effet de bord.
  // La clé texte évite de relancer l'effet à chaque rendu (le tableau est neuf).
  const datesKey = dates.join(',');
  useEffect(() => {
    onDatesChange(new Set(datesKey ? datesKey.split(',') : []));
    setShowAllDates(false);
  }, [datesKey, onDatesChange]);

  const shownResults = showAllResults ? results : results.slice(0, RESULTS_SHOWN);
  const shownDates = showAllDates ? [...dates].reverse() : [...dates].reverse().slice(0, DATES_SHOWN);
  const searching = query.trim().length >= 2 || cat !== 'all';

  function addToBasket(keys: string[]) {
    if (keys.length === 0) return;
    setBasket((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.add(k);
      return next;
    });
  }

  function toggleBasket(key: string) {
    setBasket((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * Choisir une catégorie ajoute D'UN COUP tous ses aliments au panier (le
   * clic individuel reste possible pour en retirer un ensuite). Revenir à
   * « Toutes catégories » ne fait que relâcher le filtre d'affichage.
   */
  function onCategoryChange(next: FoodCategory | 'all' | 'none') {
    setCat(next);
    setShowAllResults(false);
    if (next !== 'all') addToBasket(filterFoodResults(freqs, foods, query, next).map((f) => f.key));
  }

  return (
    <div className="panel">
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowAllResults(false); }}
          placeholder="Rechercher un aliment… (« saumon » : quand en ai-je mangé ?)"
          style={{ flex: '1 1 240px' }}
          aria-label="Rechercher un aliment dans l'historique"
        />
        <select
          value={cat}
          onChange={(e) => onCategoryChange(e.target.value as FoodCategory | 'all' | 'none')}
          aria-label="Filtrer par catégorie (l'ajoute au panier)"
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
            Effacer la recherche
          </button>
        )}
      </div>

      <UnclassifiedFoods freqs={freqs} />

      {searching && results.length === 0 && (
        <div className="hint">Aucun aliment ne correspond dans l'historique.</div>
      )}

      {results.length > 0 && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            {shownResults.map((f) => (
              <button
                key={f.key}
                className={`small ${basket.has(f.key) ? 'chip-active' : 'ghost'}`}
                onClick={() => toggleBasket(f.key)}
                data-tip={basket.has(f.key) ? 'Retirer de la sélection' : 'Ajouter à la sélection'}
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
          <div className="row small" style={{ marginTop: 6 }}>
            <button
              className="ghost small"
              onClick={() => addToBasket(results.map((f) => f.key))}
              disabled={results.every((f) => basket.has(f.key))}
            >
              + Ajouter {results.length > 1 ? `les ${results.length} résultats` : 'ce résultat'} à la sélection
            </button>
          </div>
        </>
      )}

      {basketItems.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
            <strong className="small">Sélection : {basketItems.length} aliment(s)</strong>
            <button className="ghost small" onClick={() => setBasket(new Set())}>
              Vider la sélection
            </button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {basketItems.map((f) => (
              <button
                key={f.key}
                className="small chip-active"
                onClick={() => toggleBasket(f.key)}
                data-tip="Retirer de la sélection"
              >
                {f.nom} ✕
              </button>
            ))}
          </div>
          {basketItems.length > 1 && (
            <label className="row small" style={{ gap: 6, alignItems: 'center', cursor: 'pointer', marginTop: 8 }}>
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

          <div className="hint" style={{ marginTop: 8 }}>
            {basketItems.length === 1 ? (
              <>
                <strong>{basketItems[0].nom}</strong> : {fmt(basketItems[0].occurrences)} fois sur{' '}
                {fmt(basketItems[0].jours)} jour(s) — dernière fois <strong>{dayLabel(basketItems[0].derniere, true)}</strong>{' '}
                ({daysSince(basketItems[0].derniere, today)}). Total {fmt(basketItems[0].grammes)} g ·{' '}
                {fmt(basketItems[0].kcal)} kcal.
              </>
            ) : (
              <>
                {fmt(basketItems.reduce((a, f) => a + f.occurrences, 0))} consommations sur{' '}
                <strong>{dates.length}</strong> jour(s) {combine === 'et' ? 'où ils apparaissent tous' : 'où au moins un apparaît'} ·
                total {fmt(basketItems.reduce((a, f) => a + f.kcal, 0))} kcal.
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
        </div>
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

  function copyDayTo(target: string) {
    duplicateDay(date, target);
    setFlash(`Journée du ${dayLabel(date, true)} recopiée ${relativeDayLabel(target)} (${dayEntries.length} repas).`);
  }

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
        {dayEntries.length > 0 && (
          <>
            {date !== today && (
              <button
                className="ghost small"
                data-tip="Recopie toutes les entrées de ce jour sur aujourd'hui (journées qui se ressemblent)"
                onClick={() => copyDayTo(today)}
              >
                ⧉ Dupliquer → aujourd'hui
              </button>
            )}
            <DayPickerButton
              label="⧉ Dupliquer vers…"
              tip="Recopier toute cette journée sur un autre jour (journée déjà vécue à l'identique, oubli d'hier…)"
              exclude={date}
              onPick={copyDayTo}
            />
          </>
        )}
        <span className="small mono" style={{ marginLeft: 'auto' }}>
          {fmt(kcal)} kcal ce jour
          <UncertaintyBadge kcal={kcal} unc={kcalUnc} />
        </span>
      </div>
      <div className="hint">
        Ce jour se consulte et se corrige comme aujourd'hui : bilan des nutriments, saisie, favoris. Sur une entrée,
        « Options » permet aussi de changer sa date, et « ⧉ Copier » de la recopier sur un autre jour.
      </div>

      <label className="row small" style={{ gap: 8, alignItems: 'center', cursor: 'pointer', marginTop: 4 }}>
        <input type="checkbox" checked={!counted} onChange={() => toggleDayMute(date)} />
        {hasEntries
          ? 'Ne pas compter ce jour dans les moyennes (jour mal rempli)'
          : 'Jeûne ce jour — le compter comme une journée à 0'}
      </label>

      {flash && <div className="status">{flash}</div>}

      <DayView date={date} />
    </div>
  );
}
