import { hhmm } from './EntryCard';
import { mealSummary, type Meal } from './meals';
import { fmt } from './format';

/**
 * Les deux façons d'annoncer un repas fait de PLUSIEURS saisies (cf. meals.ts) :
 * replié, une ligne qui énumère les aliments ; ouvert, un en-tête qui permet de
 * le refermer.
 *
 * Ces composants n'ont pas d'état : l'ouverture vit dans `DayView`, pour que les
 * cartes d'entrée restent des enfants directs de la journée. Sans cela, rattacher
 * une saisie à un repas changerait leur parent, React les remonterait, et le
 * panneau « Options » se refermerait sous les doigts au moment précis où l'on
 * vient d'y cliquer.
 *
 * Un repas d'UNE saisie n'utilise rien de tout ça : sa carte compacte existe déjà
 * dans `EntryCard`, avec sa dictée en résumé.
 */

/** Ligne d'un repas replié : heure, aliments énumérés, total. */
export function MealCompactLine({ meal, onOpen }: { meal: Meal; onOpen: () => void }) {
  return (
    <div className="panel entry-card entry-compact">
      <button type="button" className="entry-compact-btn" aria-expanded={false} onClick={onOpen}>
        <span className="sec-chevron" aria-hidden="true">
          ▸
        </span>
        <span className="mono entry-compact-time">{hhmm(meal.start)}</span>
        <span className="entry-compact-title">{mealSummary(meal)}</span>
        <span className="mono entry-compact-kcal">
          {fmt(meal.kcal)} kcal · {meal.itemCount} aliment{meal.itemCount > 1 ? 's' : ''}
        </span>
      </button>
    </div>
  );
}

/**
 * En-tête d'un repas ouvert depuis la vue compacte. Il n'apparaît QUE dans ce
 * cas : en mode « tout déplier », la journée reste la suite de cartes qu'elle a
 * toujours été, sans niveau de titre supplémentaire.
 */
export function MealHeader({ meal, onClose }: { meal: Meal; onClose: () => void }) {
  return (
    <button type="button" className="meal-head" aria-expanded onClick={onClose}>
      <span className="sec-chevron open" aria-hidden="true">
        ▸
      </span>
      <span className="mono">{hhmm(meal.start)}</span>
      <span className="small">
        {meal.entries.length} saisies · {fmt(meal.kcal)} kcal
      </span>
    </button>
  );
}
