import { useMemo } from 'react';
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
import { Sun } from './Sun';
import { DayNote } from './DayNote';
import { DayAdviceCard } from './DayAdvice';
import { dayLabel } from './DayPicker';

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

  return (
    <>
      <Capture
        key={`cap-${date}`}
        date={isToday ? undefined : date}
        title={isToday ? undefined : `Dicter, taper ou photographier un repas${quand}`}
      />
      <FavoriteMeals date={isToday ? undefined : date} />
      <ManualAdd date={isToday ? undefined : date} title={isToday ? undefined : `Ajouter un aliment${quand}`} />
      <Totals totals={totals} items={items} incertitude={kcalUnc} />
      {dayEntries.length === 0 ? (
        <div className="panel">
          <div className="empty">
            {isToday
              ? "Aucune entrée aujourd'hui. Dictez ou tapez votre premier repas."
              : 'Aucune entrée ce jour — ajoutez ce que vous avez mangé ci-dessus.'}
          </div>
        </div>
      ) : (
        dayEntries.map((e) => <EntryCard key={e.id} entry={e} />)
      )}
      <Sun key={`sun-${date}`} date={isToday ? undefined : date} />
      <DayNote key={`note-${date}`} date={date} />
      <DayAdviceCard key={`advice-${date}`} totals={totals} date={date} />
    </>
  );
}
