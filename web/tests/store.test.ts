import { describe, expect, it, beforeEach } from 'vitest';
import { useStore, todayStr, recentFoodCounts } from '../src/store/store';
import { buildBackup, importBackup, journalToCsv, weightsToCsv } from '../src/store/backup';
import { FOOD_BY_ID } from '../src/nutrition/foods';

const banane = FOOD_BY_ID.get('banane')!;
const today = todayStr();

/** Date locale N jours avant aujourd'hui. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayStr(d);
}

beforeEach(() => {
  useStore.setState({ entries: [], customFoods: [], foodOverrides: {}, favoriteMeals: [] });
});

describe('repas favoris', () => {
  it('enregistre puis applique un favori (valeurs recalculées)', () => {
    const s = useStore.getState();
    const entryId = s.addFoodEntry(banane, 2, 'piece');
    const entry = useStore.getState().entries.find((e) => e.id === entryId)!;

    useStore.getState().saveFavoriteMeal('Petit-déj habituel', entry.items);
    const fav = useStore.getState().favoriteMeals[0];
    expect(fav.nom).toBe('Petit-déj habituel');
    expect(fav.items).toHaveLength(1);

    const newId = useStore.getState().applyFavoriteMeal(fav.id);
    const created = useStore.getState().entries.find((e) => e.id === newId)!;
    expect(created.date).toBe(today);
    expect(created.transcript).toBe('⭐ Petit-déj habituel');
    expect(created.items[0].foodId).toBe('banane');
    expect(created.items[0].nutrients.kcal).toBeGreaterThan(0);
  });

  it('applique un favori sur un jour passé si demandé', () => {
    useStore.getState().saveFavoriteMeal('Dîner type', [
      { foodId: 'banane', nomAffiche: 'banane', quantite: 1, unite: 'piece', estimation: false },
    ]);
    const fav = useStore.getState().favoriteMeals[0];
    const id = useStore.getState().applyFavoriteMeal(fav.id, daysAgo(1));
    expect(useStore.getState().entries.find((e) => e.id === id)!.date).toBe(daysAgo(1));
  });

  it('removeFavoriteMeal supprime le favori', () => {
    useStore.getState().saveFavoriteMeal('À supprimer', []);
    const fav = useStore.getState().favoriteMeals[0];
    useStore.getState().removeFavoriteMeal(fav.id);
    expect(useStore.getState().favoriteMeals).toHaveLength(0);
  });
});

describe('duplication de repas / jour', () => {
  it("duplicateEntry recopie un repas passé sur aujourd'hui (nouveaux ids)", () => {
    const srcId = useStore.getState().addFoodEntry(banane, 1, 'piece', daysAgo(3));
    useStore.getState().duplicateEntry(srcId);
    const entries = useStore.getState().entries;
    expect(entries).toHaveLength(2);
    const copy = entries.find((e) => e.id !== srcId)!;
    expect(copy.date).toBe(today);
    expect(copy.items[0].nomAffiche).toBe(entries.find((e) => e.id === srcId)!.items[0].nomAffiche);
    expect(copy.items[0].id).not.toBe(entries.find((e) => e.id === srcId)!.items[0].id);
  });

  it("duplicateDay recopie toutes les entrées d'un jour", () => {
    useStore.getState().addFoodEntry(banane, 1, 'piece', daysAgo(2));
    useStore.getState().addFoodEntry(banane, 2, 'piece', daysAgo(2));
    useStore.getState().duplicateDay(daysAgo(2));
    const todays = useStore.getState().entries.filter((e) => e.date === today);
    expect(todays).toHaveLength(2);
  });
});

describe('recentFoodCounts', () => {
  it('compte les aliments des derniers jours, pas les anciens', () => {
    useStore.getState().addFoodEntry(banane, 1, 'piece', daysAgo(1));
    useStore.getState().addFoodEntry(banane, 1, 'piece', daysAgo(2));
    useStore.getState().addFoodEntry(banane, 1, 'piece', daysAgo(60));
    const counts = recentFoodCounts(useStore.getState().entries, 14);
    expect(counts.get('banane')).toBe(2);
  });
});

describe('export / import (sauvegarde)', () => {
  it('le JSON exporté se ré-importe à l’identique', () => {
    useStore.getState().addFoodEntry(banane, 1, 'piece');
    useStore.getState().saveFavoriteMeal('Test', []);
    const json = JSON.stringify(buildBackup());

    // On vide tout, puis on restaure.
    useStore.setState({ entries: [], favoriteMeals: [], weightEntries: [] });
    const msg = importBackup(json);
    expect(msg).toContain('Import réussi');
    expect(useStore.getState().entries).toHaveLength(1);
    expect(useStore.getState().favoriteMeals).toHaveLength(1);
    expect(useStore.getState().weightEntries.length).toBeGreaterThan(0);
  });

  it('rejette un fichier non FoodRecorder', () => {
    expect(() => importBackup('{"foo":1}')).toThrow(/FoodRecorder/);
    expect(() => importBackup('pas du json')).toThrow(/JSON/);
  });

  it('journalToCsv produit une ligne par aliment', () => {
    useStore.getState().addFoodEntry(banane, 2, 'piece');
    const csv = journalToCsv(useStore.getState().entries);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('date;heure;aliment');
    expect(lines).toHaveLength(2);
    expect(lines[1].toLowerCase()).toContain('banane');
  });

  it('weightsToCsv contient les pesées du seed', () => {
    const csv = weightsToCsv(useStore.getState().weightEntries);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('poids');
    expect(lines.length).toBe(useStore.getState().weightEntries.length + 1);
  });
});
