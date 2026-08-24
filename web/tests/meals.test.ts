import { describe, expect, it } from 'vitest';
import { groupIntoMeals, mealPositions, mealSummary, MEAL_GAP_MIN } from '../src/ui/meals';
import type { JournalEntry } from '../src/store/store';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';

/**
 * Le regroupement des saisies en repas. Ce qui compte : la règle des 30 minutes,
 * et surtout le fait que la correction manuelle l'emporte toujours — c'est elle
 * qui rattrape les journées saisies après coup, où tout partage le même
 * horodatage.
 */

const T0 = new Date('2026-08-24T12:30:00').getTime();
const MIN = 60_000;

function entry(id: string, minutes: number, noms: string[], mealLink?: 'join' | 'break'): JournalEntry {
  return {
    id,
    date: '2026-08-24',
    createdAt: T0 + minutes * MIN,
    transcript: '',
    source: 'manuel',
    items: noms.map((nom, i) => ({
      id: `${id}-${i}`,
      foodId: null,
      nomAffiche: nom,
      quantite: 100,
      unite: 'g' as const,
      grams: 100,
      nutrients: { ...EMPTY_NUTRIENTS, kcal: 100 },
      estimation: false,
      douteux: false,
    })),
    ...(mealLink ? { mealLink } : {}),
  };
}

describe('groupIntoMeals', () => {
  it('réunit les saisies rapprochées et coupe au-delà de la fenêtre', () => {
    const meals = groupIntoMeals([
      entry('a', 0, ['Viande hachée']),
      entry('b', 4, ['Ketchup']),
      entry('c', 11, ['Brocolis']),
      entry('d', 45, ['Yaourt']), // 34 min après « c » : nouveau repas
    ]);
    expect(meals).toHaveLength(2);
    expect(meals[0].entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(meals[1].entries.map((e) => e.id)).toEqual(['d']);
    expect(meals[0].kcal).toBe(300);
    expect(meals[0].itemCount).toBe(3);
  });

  it('mesure l’écart depuis la saisie précédente, pas depuis le début du repas', () => {
    // Un repas saisi au fil de l'eau peut durer plus que la fenêtre sans se couper.
    const meals = groupIntoMeals([entry('a', 0, ['Apéro']), entry('b', 25, ['Plat']), entry('c', 50, ['Dessert'])]);
    expect(meals).toHaveLength(1);
  });

  it('rend les repas du plus ancien au plus récent, quel que soit l’ordre reçu', () => {
    const meals = groupIntoMeals([entry('tard', 90, ['Dîner']), entry('tot', 0, ['Déjeuner'])]);
    expect(meals.map((m) => m.entries[0].id)).toEqual(['tot', 'tard']);
  });

  it('« break » ouvre un repas malgré des saisies collées', () => {
    const meals = groupIntoMeals([entry('a', 0, ['Steak']), entry('b', 2, ['Pomme'], 'break')]);
    expect(meals).toHaveLength(2);
  });

  it('« join » rattache malgré des heures très éloignées', () => {
    // Le cas de la journée rattrapée le soir : les écarts ne veulent plus rien dire.
    const meals = groupIntoMeals([entry('a', 0, ['Steak']), entry('b', 300, ['Brocolis'], 'join')]);
    expect(meals).toHaveLength(1);
    expect(meals[0].entries.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('ignore un « join » sur la toute première saisie du jour', () => {
    const meals = groupIntoMeals([entry('a', 0, ['Steak'], 'join')]);
    expect(meals).toHaveLength(1);
    expect(meals[0].id).toBe('a');
  });

  it('ne groupe rien quand le journal est vide', () => {
    expect(groupIntoMeals([])).toEqual([]);
  });

  it('utilise bien une fenêtre de 30 minutes par défaut', () => {
    expect(MEAL_GAP_MIN).toBe(30);
    expect(groupIntoMeals([entry('a', 0, ['x']), entry('b', 30, ['y'])])).toHaveLength(1);
    expect(groupIntoMeals([entry('a', 0, ['x']), entry('b', 31, ['y'])])).toHaveLength(2);
  });
});

describe('mealSummary', () => {
  it('énumère les aliments par des virgules, dans l’ordre de saisie', () => {
    const [meal] = groupIntoMeals([entry('a', 0, ['Viande hachée', 'Ketchup']), entry('b', 3, ['Brocolis'])]);
    expect(mealSummary(meal)).toBe('Viande hachée, Ketchup, Brocolis');
  });

  it('ne nomme qu’une fois un aliment repris dans le même repas', () => {
    const [meal] = groupIntoMeals([entry('a', 0, ['Café']), entry('b', 5, ['café', 'Sucre'])]);
    expect(mealSummary(meal)).toBe('Café, Sucre');
  });
});

describe('mealPositions', () => {
  it('marque la première saisie de chaque repas et donne l’heure du repas précédent', () => {
    const meals = groupIntoMeals([entry('a', 0, ['x']), entry('b', 5, ['y']), entry('c', 60, ['z'])]);
    const pos = mealPositions(meals);
    expect(pos.get('a')).toEqual({ isFirst: true, previousStart: null });
    expect(pos.get('b')!.isFirst).toBe(false);
    expect(pos.get('c')).toEqual({ isFirst: true, previousStart: meals[0].start });
  });
});
