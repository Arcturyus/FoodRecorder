import { useEffect, useMemo, useState } from 'react';
import { useStore, dayTotals, todayStr } from '../store/store';
import type { JournalItem } from '../store/store';
import { EMPTY_NUTRIENTS } from '../nutrition/types';
import { dayKcalUncertainty } from '../nutrition/uncertainty';
import { sunVitDForDate } from '../sun/vitaminD';
import { Capture } from './Capture';
import { FavoriteMeals } from './FavoriteMeals';
import { ManualAdd } from './ManualAdd';
import { Totals } from './Totals';
import { EntryCard } from './EntryCard';
import { MealCompactLine, MealHeader } from './MealCard';
import { groupIntoMeals, mealPositions } from './meals';
import { Sun } from './Sun';
import { DayNote } from './DayNote';
import { DayAdviceCard } from './DayAdvice';
import { QueueStatus } from './QueueStatus';
import { dayLabel } from './DayPicker';
import { fmt } from './format';
import { UI_STORE, useUiPref } from './uiPrefs';

/**
 * Tout ce qui compose une journée : saisie (dictée, favoris, ajout manuel),
 * bilan nutritionnel, repas, soleil, note et conseils. Un seul composant pour
 * l'onglet du jour ET pour le jour ouvert depuis le calendrier de l'historique,
 * de sorte qu'un jour passé se consulte et se corrige exactement comme
 * aujourd'hui — bilan des nutriments compris.
 */
export function DayView({ date }: { date: string }) {
  const entries = useStore((s) => s.entries);
  const sunExposures = useStore((s) => s.sunExposures);
  const isToday = date === todayStr();
  const quand = isToday ? '' : ` du ${dayLabel(date, true)}`;

  const dayEntries = useMemo(
    () => entries.filter((e) => e.date === date).sort((a, b) => b.createdAt - a.createdAt),
    [entries, date],
  );

  // Le soleil n'est pas un aliment : son gain de vitamine D estimé s'ajoute au
  // bilan du jour via un pseudo-item (visible dans l'infobulle « Principaux apports »).
  const sunVitD = useMemo(() => sunVitDForDate(sunExposures, date), [sunExposures, date]);
  const items = useMemo(() => {
    const list = dayEntries.flatMap((e) => e.items);
    if (sunVitD <= 0) return list;
    const sunItem: JournalItem = {
      id: 'sun-day',
      foodId: null,
      nomAffiche: '☀️ Soleil (exposition)',
      quantite: 1,
      unite: 'g',
      grams: 0,
      nutrients: { ...EMPTY_NUTRIENTS, vitD: sunVitD },
      estimation: true,
      douteux: false,
    };
    return [...list, sunItem];
  }, [dayEntries, sunVitD]);

  const totals = useMemo(() => {
    const t = dayTotals(entries, date);
    return sunVitD > 0 ? { ...t, vitD: t.vitD + sunVitD } : t;
  }, [entries, date, sunVitD]);
  const kcalUnc = useMemo(() => dayKcalUncertainty(dayEntries), [dayEntries]);

  /**
   * Repas repliés par défaut : une journée bien remplie empilait cinq cartes
   * détaillées sous le bilan, alors que la question courante — « qu'est-ce que
   * j'ai mangé, pour combien de calories ? » — se répond en une ligne. Le
   * détail (quantités, correction, suppression) reste à un clic.
   */
  const [compact, setCompact] = useUiPref(UI_STORE, 'day-entries-compact', true);

  /**
   * Les saisies rapprochées sont présentées comme un seul repas : trois cartes
   * (« steak », « ketchup », « brocolis ») décrivent une assiette, pas trois
   * (cf. meals.ts). Les entrées elles-mêmes ne sont pas fusionnées.
   */
  const meals = useMemo(() => groupIntoMeals(dayEntries), [dayEntries]);
  const positions = useMemo(() => mealPositions(meals), [meals]);

  /**
   * Repas ouverts un par un depuis la vue compacte. L'état vit ICI et non dans
   * la carte du repas : les cartes d'entrée restent ainsi des enfants directs de
   * la journée, avec une clé stable, et gardent leur état (« Options » ouvert,
   * édition en cours) quand rattacher une saisie réorganise les groupes.
   */
  const [openMeals, setOpenMeals] = useState<ReadonlySet<string>>(new Set());
  // « Tout replier » / « tout déplier » reprend la main sur ces ouvertures.
  useEffect(() => {
    setOpenMeals(new Set());
  }, [compact]);
  const toggleMeal = (id: string) =>
    setOpenMeals((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <>
      {/* En tête : ce que la file a encore à traiter — une dictée envoyée du téléphone
          n'apparaît dans le journal qu'après analyse, et l'attente était jusqu'ici muette. */}
      <QueueStatus />
      <Capture
        key={`cap-${date}`}
        date={isToday ? undefined : date}
        title={isToday ? undefined : `Dicter, taper ou photographier un repas${quand}`}
      />
      <FavoriteMeals date={isToday ? undefined : date} />
      <ManualAdd date={isToday ? undefined : date} title={isToday ? undefined : `Ajouter un aliment${quand}`} />
      <Totals totals={totals} items={items} incertitude={kcalUnc} date={date} />
      {dayEntries.length === 0 ? (
        <div className="panel">
          <div className="empty">
            {isToday
              ? "Aucune entrée aujourd'hui. Dictez ou tapez votre premier repas."
              : 'Aucune entrée ce jour — ajoutez ce que vous avez mangé ci-dessus.'}
          </div>
        </div>
      ) : (
        <>
          <div className="fold-head entries-head">
            <span className="small" style={{ color: 'var(--muted)' }}>
              {meals.length} repas · {fmt(dayEntries.reduce((a, e) => a + e.items.length, 0))} aliments
            </span>
            <button className="ghost small" onClick={() => setCompact(!compact)}>
              {compact ? 'Tout déplier' : 'Tout replier'}
            </button>
          </div>
          {/* Du plus récent au plus ancien, comme les entrées avant le regroupement. */}
          {[...meals].reverse().flatMap((meal) => {
            // Repas d'une seule saisie : la carte d'entrée fait déjà tout, avec
            // sa dictée en résumé compact.
            if (meal.entries.length === 1) {
              const only = meal.entries[0];
              return [<EntryCard key={only.id} entry={only} collapsed={compact} mealPos={positions.get(only.id)} />];
            }
            if (compact && !openMeals.has(meal.id)) {
              return [<MealCompactLine key={meal.id} meal={meal} onOpen={() => toggleMeal(meal.id)} />];
            }
            const cards = [...meal.entries]
              .reverse()
              .map((e) => <EntryCard key={e.id} entry={e} mealPos={positions.get(e.id)} />);
            return compact
              ? [<MealHeader key={`head-${meal.id}`} meal={meal} onClose={() => toggleMeal(meal.id)} />, ...cards]
              : cards;
          })}
        </>
      )}
      <Sun key={`sun-${date}`} date={isToday ? undefined : date} />
      <DayNote key={`note-${date}`} date={date} />
      <DayAdviceCard key={`advice-${date}`} totals={totals} date={date} />
    </>
  );
}
