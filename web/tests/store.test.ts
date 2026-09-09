import { describe, expect, it, beforeEach } from 'vitest';
import { useStore, todayStr, recentFoodCounts, resolveItemNutrients } from '../src/store/store';
import { buildBackup, importBackup, journalToCsv, progressToCsv, weightsToCsv } from '../src/store/backup';
import { FOOD_BY_ID } from '../src/nutrition/foods';
import { adoptFromCatalog } from '../src/nutrition/bank';
import { isPhotoEntry } from '../src/nutrition/uncertainty';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { ExtractedItem } from '../src/nutrition/types';

const banane = FOOD_BY_ID.get('banane')!;
const today = todayStr();

/** Item extrait « une banane », résolu par le matching sur la banque. */
function banItem(): ExtractedItem {
  return { aliment: 'banane', quantite: 1, unite: 'piece', estimation: false };
}

/**
 * Item estimé par l'IA (hors banque, sans catégorie) : le cas exact de
 * l'historique saisi avant que l'app ne conserve la catégorie.
 */
function iaItem(nom: string): ExtractedItem {
  return {
    aliment: nom,
    quantite: 1,
    unite: 'piece',
    estimation: false,
    nutriments: { ...EMPTY_NUTRIENTS, kcal: 250 },
    grammesParPiece: 100,
  };
}

/**
 * Item que RIEN ne résout : ni la banque (nom inconnu), ni l'IA (aucune valeur
 * fournie). C'est le seul cas qui reste sans catégorie — depuis la banque
 * personnelle, une estimation IA devient un aliment et porte donc la sienne.
 */
function inconnuItem(nom: string): ExtractedItem {
  return { aliment: nom, quantite: 1, unite: 'piece', estimation: false };
}

/** Date locale N jours avant aujourd'hui. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayStr(d);
}

/**
 * Ma banque de test. Elle ne contient QUE des aliments « déjà mangés » : depuis
 * la bascule vers la banque personnelle, le catalogue de référence ne participe
 * plus au matching tant qu'un aliment n'y a pas été copié.
 */
const bank = (...ids: string[]) => ids.map((id) => adoptFromCatalog(FOOD_BY_ID.get(id)!));

beforeEach(() => {
  useStore.setState({ entries: [], customFoods: bank('banane', 'pomme', 'saumon'), favoriteMeals: [] });
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

  it('ne recopie pas la dictée (elle décrivait le repas d’un autre jour)', () => {
    const srcId = useStore
      .getState()
      .addEntry('hier midi j’ai mangé une banane', [banItem()], 'claudecode', daysAgo(3));
    useStore.getState().duplicateEntry(srcId);
    const copy = useStore.getState().entries.find((e) => e.id !== srcId)!;
    expect(copy.transcript).toBe('');
    expect(copy.items[0].nomAffiche).toBe('Banane');
    // duplicateDay suit la même règle.
    useStore.getState().duplicateDay(daysAgo(3), daysAgo(1));
    const dayCopy = useStore.getState().entries.find((e) => e.date === daysAgo(1))!;
    expect(dayCopy.transcript).toBe('');
  });

  it('garde le marqueur photo, dont dépend l’incertitude sur les quantités', () => {
    const srcId = useStore.getState().addEntry('📷 Photo', [banItem()], 'claudecode', daysAgo(3));
    useStore.getState().duplicateEntry(srcId);
    const copy = useStore.getState().entries.find((e) => e.id !== srcId)!;
    expect(isPhotoEntry(copy)).toBe(true);
  });
});

describe('catégories des aliments non résolus', () => {
  it('setItemCategories classe les items non résolus, sans toucher aux autres', () => {
    const id = useStore.getState().addEntry('', [inconnuItem('brick au thon')], 'claudecode');
    const bananeId = useStore.getState().addFoodEntry(banane, 1, 'piece');

    const n = useStore.getState().setItemCategories({ 'Brick au thon': 'poisson' });

    expect(n).toBe(1);
    expect(useStore.getState().entries.find((e) => e.id === id)!.items[0].categorie).toBe('poisson');
    // Un item résolu tient sa catégorie de la banque : on ne la duplique pas sur l'item.
    expect(useStore.getState().entries.find((e) => e.id === bananeId)!.items[0].categorie).toBeUndefined();
  });

  it('ne reclasse jamais un item déjà classé', () => {
    const id = useStore.getState().addEntry('', [inconnuItem('brick au thon')], 'claudecode');
    useStore.getState().setItemCategories({ 'brick au thon': 'poisson' });
    const n = useStore.getState().setItemCategories({ 'brick au thon': 'plat' });
    expect(n).toBe(0);
    expect(useStore.getState().entries.find((e) => e.id === id)!.items[0].categorie).toBe('poisson');
  });
});

describe('repas favoris — renommage', () => {
  it('renomme un favori (les anciens portaient la dictée entière)', () => {
    useStore.getState().saveFavoriteMeal('alors du fromage blanc je dirais 200 g avec', []);
    const fav = useStore.getState().favoriteMeals[0];
    useStore.getState().renameFavoriteMeal(fav.id, '  Fromage blanc chocolat  ');
    expect(useStore.getState().favoriteMeals[0].nom).toBe('Fromage blanc chocolat');
    // Un nom vide ne détruit pas le favori.
    useStore.getState().renameFavoriteMeal(fav.id, '   ');
    expect(useStore.getState().favoriteMeals[0].nom).toBe('Fromage blanc chocolat');
  });
});

describe('repas favoris — édition du contenu', () => {
  it('modifie un aliment existant (quantité, unité, remplacement)', () => {
    useStore.getState().saveFavoriteMeal('Petit-déj', [
      { foodId: 'banane', nomAffiche: 'Banane', quantite: 1, unite: 'piece', estimation: false },
    ]);
    const fav = useStore.getState().favoriteMeals[0];

    useStore.getState().updateFavoriteMealItem(fav.id, 0, { quantite: 2 });
    expect(useStore.getState().favoriteMeals[0].items[0].quantite).toBe(2);

    const pomme = FOOD_BY_ID.get('pomme') ?? FOOD_BY_ID.get('oeuf')!;
    useStore.getState().updateFavoriteMealItem(fav.id, 0, { foodId: pomme.id, nomAffiche: pomme.nom });
    expect(useStore.getState().favoriteMeals[0].items[0].foodId).toBe(pomme.id);
  });

  it('ajoute et retire des aliments d’un favori', () => {
    useStore.getState().saveFavoriteMeal('Shaker', [
      { foodId: 'banane', nomAffiche: 'Banane', quantite: 1, unite: 'piece', estimation: false },
    ]);
    const fav = useStore.getState().favoriteMeals[0];

    useStore.getState().addFavoriteMealItem(fav.id, {
      foodId: 'banane',
      nomAffiche: 'Banane',
      quantite: 200,
      unite: 'g',
      estimation: false,
    });
    expect(useStore.getState().favoriteMeals[0].items).toHaveLength(2);

    useStore.getState().removeFavoriteMealItem(fav.id, 0);
    const after = useStore.getState().favoriteMeals[0].items;
    expect(after).toHaveLength(1);
    expect(after[0].quantite).toBe(200);
  });

  it('ne touche pas aux autres favoris', () => {
    useStore.getState().saveFavoriteMeal('A', [
      { foodId: 'banane', nomAffiche: 'Banane', quantite: 1, unite: 'piece', estimation: false },
    ]);
    useStore.getState().saveFavoriteMeal('B', [
      { foodId: 'banane', nomAffiche: 'Banane', quantite: 1, unite: 'piece', estimation: false },
    ]);
    const [favB, favA] = useStore.getState().favoriteMeals; // ordre : le plus récent en tête

    useStore.getState().updateFavoriteMealItem(favA.id, 0, { quantite: 5 });

    expect(useStore.getState().favoriteMeals.find((f) => f.id === favA.id)!.items[0].quantite).toBe(5);
    expect(useStore.getState().favoriteMeals.find((f) => f.id === favB.id)!.items[0].quantite).toBe(1);
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

describe('ajustement « pour cette fois » (setItemNutrients)', () => {
  it('remplace les apports de l’item sans toucher à l’aliment de la base', () => {
    const entryId = useStore.getState().addFoodEntry(banane, 1, 'piece'); // 1 pièce ≈ pieceGrams
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    const grams = item.grams;

    const patched = { ...item.nutrients, proteines: 12 };
    useStore.getState().setItemNutrients(entryId, item.id, patched);

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.nutrients.proteines).toBeCloseTo(12, 5);
    expect(after.customN).toBeDefined();
    // customN est stocké « pour 100 g » : 12 g sur `grams` g → 12 * 100 / grams.
    expect(after.customN!.proteines).toBeCloseTo((12 * 100) / grams, 5);
    // La banque n'est pas modifiée.
    expect(FOOD_BY_ID.get('banane')!.n.proteines).not.toBeCloseTo(12, 5);
  });

  it('rescale l’ajustement quand la quantité change', () => {
    const entryId = useStore.getState().addFoodEntry(banane, 1, 'piece');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    useStore.getState().setItemNutrients(entryId, item.id, { ...item.nutrients, proteines: 10 });
    useStore.getState().updateItem(entryId, item.id, { quantite: 2 });

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.nutrients.proteines).toBeCloseTo(20, 4);
    expect(after.customN).toBeDefined();
  });

  it('null rétablit les valeurs de l’aliment', () => {
    const entryId = useStore.getState().addFoodEntry(banane, 1, 'piece');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    const original = item.nutrients.proteines;
    useStore.getState().setItemNutrients(entryId, item.id, { ...item.nutrients, proteines: 99 });
    useStore.getState().setItemNutrients(entryId, item.id, null);

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.customN).toBeUndefined();
    expect(after.nutrients.proteines).toBeCloseTo(original, 5);
  });

  it('changer d’aliment annule l’ajustement', () => {
    const entryId = useStore.getState().addFoodEntry(banane, 1, 'piece');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    useStore.getState().setItemNutrients(entryId, item.id, { ...item.nutrients, proteines: 99 });
    const pomme = FOOD_BY_ID.get('pomme') ?? FOOD_BY_ID.get('oeuf');
    useStore.getState().updateItem(entryId, item.id, { foodId: pomme!.id });

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.customN).toBeUndefined();
    expect(after.foodId).toBe(pomme!.id);
  });
});

describe('correction de la banque depuis un item', () => {
  it('ramène la correction à 100 g, recalcule l’historique et enlève l’ajustement ponctuel de cet item', () => {
    const firstId = useStore.getState().addFoodEntry(banane, 1, 'piece');
    const secondId = useStore.getState().addFoodEntry(banane, 2, 'piece');
    const first = useStore.getState().entries.find((e) => e.id === firstId)!.items[0];
    useStore.getState().setItemNutrients(firstId, first.id, { ...first.nutrients, proteines: 12 });

    expect(useStore.getState().setItemNutrientsGlobally(firstId, first.id, { ...first.nutrients, proteines: 12 })).toBe(true);

    const [afterFirst] = useStore.getState().entries.find((e) => e.id === firstId)!.items;
    const [afterSecond] = useStore.getState().entries.find((e) => e.id === secondId)!.items;
    expect(afterFirst.customN).toBeUndefined();
    expect(afterFirst.nutrients.proteines).toBeCloseTo(12, 5);
    expect(afterSecond.nutrients.proteines).toBeCloseTo(24, 5);
    expect(useStore.getState().customFoods.find((f) => f.id === 'banane')!.n.proteines).toBeCloseTo((12 * 100) / first.grams, 5);
  });

  it('refuse une correction globale pour un item sans aliment associé', () => {
    const entryId = useStore.getState().addEntry('inconnu', [inconnuItem('truc sans base')], 'manuel');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(useStore.getState().setItemNutrientsGlobally(entryId, item.id, item.nutrients)).toBe(false);
  });
});

describe('renommage d’un aliment du journal (renameItem)', () => {
  it('renomme un aliment de la banque en gardant ses apports', () => {
    const entryId = useStore.getState().addFoodEntry(banane, 1, 'piece');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    const kcal = item.nutrients.kcal;

    useStore.getState().renameItem(entryId, item.id, 'banane bien mûre');

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.nomAffiche).toBe('banane bien mûre');
    expect(after.nutrients.kcal).toBeCloseTo(kcal, 5);
    // L'aliment reste attaché (conversion pièce → grammes), mais ses apports
    // sont figés « pour cette fois » pour que le nom libre ne soit pas réécrit.
    expect(after.foodId).toBe('banane');
    expect(after.customN).toBeDefined();
  });

  it('le nom libre survit à un changement de quantité (rescale)', () => {
    const entryId = useStore.getState().addFoodEntry(banane, 1, 'piece');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    const kcal = item.nutrients.kcal;
    useStore.getState().renameItem(entryId, item.id, 'grosse banane');
    useStore.getState().updateItem(entryId, item.id, { quantite: 2 });

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.nomAffiche).toBe('grosse banane');
    expect(after.nutrients.kcal).toBeCloseTo(kcal * 2, 4);
  });

  it('corriger le nom d’un aliment non résolu le re-matche sur la banque', () => {
    // « tarte flambée » n'est pas dans la banque : l'item reste non résolu.
    const entryId = useStore.getState().addEntry('', [{ aliment: 'tarte flambée', quantite: 1, unite: 'piece', estimation: false }], 'manuel');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(item.foodId).toBeNull();
    useStore.getState().renameItem(entryId, item.id, 'banane');

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.foodId).toBe('banane');
    expect(after.nutrients.kcal).toBeGreaterThan(0);
  });

  it('garde les valeurs de l’aliment né de l’estimation IA quand on précise son nom', () => {
    const entryId = useStore.getState().addEntry('', [iaItem('tarte flambée')], 'llm');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    const kcal = item.nutrients.kcal;
    // L'estimation ne reste plus enfermée dans l'item : elle a fait entrer un
    // aliment dans ma banque, et c'est lui que l'item référence désormais.
    expect(item.foodId).toBe('mine-tarte-flambee');
    expect(useStore.getState().customFoods.find((f) => f.id === item.foodId)?.aVerifier).toBe(true);
    expect(kcal).toBeGreaterThan(0);

    useStore.getState().renameItem(entryId, item.id, 'tarte flambée maison');

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.nomAffiche).toBe('tarte flambée maison');
    expect(after.nutrients.kcal).toBeCloseTo(kcal, 5);
  });

  it('un nom vide ou inchangé ne touche à rien', () => {
    const entryId = useStore.getState().addFoodEntry(banane, 1, 'piece');
    const item = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    useStore.getState().renameItem(entryId, item.id, '   ');
    useStore.getState().renameItem(entryId, item.id, item.nomAffiche);

    const after = useStore.getState().entries.find((e) => e.id === entryId)!.items[0];
    expect(after.foodId).toBe('banane');
    expect(after.customN).toBeUndefined();
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

  it('progressToCsv réunit apports, balance et mensurations dans une ligne quotidienne', () => {
    useStore.setState({ profile: { ...useStore.getState().profile, sportHeures: 5, sportType: 'mixte' } });
    useStore.getState().addFoodEntry(banane, 1, 'piece', '2026-01-01');
    const weightId = useStore.getState().addWeightEntry({ date: '2026-01-01', heure: '08:00', aJeun: true, nu: true, poids: 65, masseGrasse: 17.5, masseMusculaire: 55, source: 'manuel' });
    const measurementId = useStore.getState().addBodyMeasurement({ date: '2026-01-01', waistCm: 76, upperArmLeftCm: 34, measurementProtocol: 'à jeun, nu' });
    const state = useStore.getState();
    const weight = state.weightEntries.find((entry) => entry.id === weightId)!;
    const measurement = state.bodyMeasurements.find((entry) => entry.id === measurementId)!;

    const [header, row] = progressToCsv(state.entries.filter((entry) => entry.date === '2026-01-01'), [weight], [measurement]).split('\r\n');
    expect(header).toContain('leanMassKg;skeletalMuscleKg;waistCm;trainingHoursPerWeek;trainingType');
    expect(row).toContain('2026-01-01;65;');
    expect(row).toContain(';76;5;mix cardio-muscu;à jeun, nu;34;');
  });
});

describe('horodatage d’envoi propagé par la synchro (addEntry / addSunExposure)', () => {
  it('addEntry date le repas de l’heure/jour d’envoi fournis, pas de maintenant', () => {
    // Cas synchro : le téléphone a envoyé hier soir à 23:50, l’ordinateur traite aujourd’hui.
    const sent = new Date(`${daysAgo(1)}T23:50:00`).getTime();
    const id = useStore.getState().addEntry(
      'banane',
      [{ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }],
      'claudecode',
      daysAgo(1),
      sent,
    );
    const entry = useStore.getState().entries.find((e) => e.id === id)!;
    expect(entry.date).toBe(daysAgo(1)); // jour d’ENVOI, pas de traitement
    expect(entry.createdAt).toBe(sent); // heure d’ENVOI, pas Date.now()
  });

  it('addEntry garde le comportement par défaut (aujourd’hui / maintenant) sans override', () => {
    const before = Date.now();
    const id = useStore.getState().addEntry(
      'banane',
      [{ aliment: 'banane', quantite: 1, unite: 'piece', estimation: false }],
      'manuel',
    );
    const entry = useStore.getState().entries.find((e) => e.id === id)!;
    expect(entry.date).toBe(today);
    expect(entry.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('addSunExposure respecte le createdAt d’envoi fourni', () => {
    const sent = new Date(`${daysAgo(1)}T12:00:00`).getTime();
    useStore.getState().addSunExposure(
      { date: daysAgo(1), heure: '12:00', dureeMin: 20, ciel: 'ensoleille', peau: 'visage-bras', phenotype: 'blanc', creme: 'aucune' },
      sent,
    );
    expect(useStore.getState().sunExposures[0].createdAt).toBe(sent);
  });
});

describe('recalcul rétroactif des nutriments depuis la base (foodId résolu)', () => {
  const steak = FOOD_BY_ID.get('steak-hache-15')!;

  it('recalcule TOUS les nutriments d’un ancien snapshot depuis la base actuelle', () => {
    // Snapshot d'AVANT un nutriment ajouté depuis (collagène, AG trans…) : la clé n'existe pas encore.
    const oldItem = { grams: 200, customN: undefined, nutrients: { kcal: 460, proteines: 48 } };
    const n = resolveItemNutrients(oldItem, steak);
    expect(n.collagene).toBeCloseTo(3.2, 5); // 1,6 g/100 g × 200 g
    expect(n.kcal).toBeCloseTo(steak.n.kcal * 2, 5); // recalculé depuis la base, pas le snapshot figé
  });

  it('ne touche pas un item ajusté à la main (customN) ni un item sans aliment résolu', () => {
    const base = { grams: 200, nutrients: { kcal: 460 } };
    expect(resolveItemNutrients({ ...base, customN: { ...steak.n } }, steak).collagene).toBe(0);
    expect(resolveItemNutrients({ ...base, customN: undefined }, null).collagene).toBe(0);
  });

  it('écrase une valeur de snapshot devenue obsolète (correction de la base propagée)', () => {
    const item = { grams: 200, customN: undefined, nutrients: { collagene: 9 } };
    // 9 était l'ancienne valeur figée ; la base actuelle (1,6 g/100 g × 200 g = 3,2) prime désormais.
    expect(resolveItemNutrients(item, steak).collagene).toBeCloseTo(3.2, 5);
  });

  it('reste à 0 pour un aliment sans collagène (banane)', () => {
    const item = { grams: 120, customN: undefined, nutrients: { kcal: 108 } };
    expect(resolveItemNutrients(item, banane).collagene).toBe(0);
  });
});
