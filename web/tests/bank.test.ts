import { describe, expect, it, beforeEach } from 'vitest';
import {
  adoptFromCatalog,
  bankFoodId,
  findDuplicates,
  mergeBankFoods,
  migrateToPersonalBank,
} from '../src/nutrition/bank';
import { useStore, resyncEntries, dayTotals } from '../src/store/store';
import type { JournalEntry, JournalItem } from '../src/store/store';
import { FOOD_BY_ID } from '../src/nutrition/foods';
import { EMPTY_NUTRIENTS, type ExtractedItem, type Nutrients } from '../src/nutrition/types';
import { scaleNutrients } from '../src/nutrition/compute';

/**
 * La banque personnelle : seuls les aliments réellement mangés comptent.
 *
 * L'enjeu central est la MIGRATION — elle réécrit tout l'historique — donc on
 * vérifie d'abord qu'elle ne change aucun chiffre, puis qu'elle est rejouable
 * sans dégât (deux appareils peuvent la lancer chacun de leur côté).
 */

const banane = FOOD_BY_ID.get('banane')!;
const pomme = FOOD_BY_ID.get('pomme')!;

/** Item de journal résolu vers un aliment du CATALOGUE : l'ancien modèle. */
function itemCatalogue(foodId: string, grams: number): JournalItem {
  const food = FOOD_BY_ID.get(foodId)!;
  return {
    id: `it-${foodId}-${grams}`,
    foodId,
    nomAffiche: food.nom,
    quantite: grams,
    unite: 'g',
    grams,
    nutrients: scaleNutrients(food.n, grams),
    estimation: false,
    douteux: false,
  };
}

/** Item estimé par l'IA, valeurs enfermées dans l'item : l'ancien modèle. */
function itemIa(nom: string, kcal: number, grams = 100): JournalItem {
  const n: Nutrients = { ...EMPTY_NUTRIENTS, kcal, proteines: 5 };
  return {
    id: `ia-${nom}-${kcal}`,
    foodId: null,
    nomAffiche: nom,
    quantite: grams,
    unite: 'g',
    grams,
    nutrients: scaleNutrients(n, grams),
    estimation: false,
    douteux: false,
    categorie: 'plat',
    iaEstime: { n },
  };
}

function entry(date: string, createdAt: number, items: JournalItem[]): JournalEntry {
  return { id: `e-${date}-${createdAt}`, date, createdAt, transcript: '', source: 'claudecode', items };
}

describe('migration vers la banque personnelle', () => {
  it('copie les aliments du catalogue RÉELLEMENT mangés, en gardant leur id', () => {
    const entries = [entry('2026-08-01', 1, [itemCatalogue('banane', 120)])];
    const r = migrateToPersonalBank({ entries, customFoods: [], foodOverrides: {}, favoriteMeals: [] });

    expect(r.customFoods).toHaveLength(1);
    const [f] = r.customFoods;
    // L'id conservé est ce qui rend la migration non destructive : la référence
    // posée dans le journal reste valide, sans re-matching.
    expect(f.id).toBe('banane');
    expect(f.origine).toBe('catalogue');
    expect(f.sourceId).toBe('banane');
    expect(f.n.kcal).toBe(banane.n.kcal);
    expect(r.entries[0].items[0].foodId).toBe('banane');
  });

  it('n’emporte PAS les aliments du catalogue jamais mangés', () => {
    const entries = [entry('2026-08-01', 1, [itemCatalogue('banane', 100)])];
    const r = migrateToPersonalBank({ entries, customFoods: [], foodOverrides: {}, favoriteMeals: [] });
    expect(r.customFoods.map((f) => f.id)).toEqual(['banane']);
    expect(r.customFoods.find((f) => f.id === 'pomme')).toBeUndefined();
  });

  it('absorbe les anciens overrides dans la copie', () => {
    const entries = [entry('2026-08-01', 1, [itemCatalogue('banane', 100)])];
    const r = migrateToPersonalBank({
      entries,
      customFoods: [],
      foodOverrides: { banane: { n: { kcal: 999 } } },
      favoriteMeals: [],
    });
    expect(r.customFoods.find((f) => f.id === 'banane')!.n.kcal).toBe(999);
  });

  it('emporte un aliment jamais mangé mais explicitement édité (l’utilisateur y tient)', () => {
    const r = migrateToPersonalBank({
      entries: [],
      customFoods: [],
      foodOverrides: { pomme: { n: { kcal: 42 } } },
      favoriteMeals: [],
    });
    expect(r.customFoods.map((f) => f.id)).toEqual(['pomme']);
    expect(r.customFoods[0].n.kcal).toBe(42);
  });

  it('emporte les aliments référencés par un repas favori', () => {
    const r = migrateToPersonalBank({
      entries: [],
      customFoods: [],
      foodOverrides: {},
      favoriteMeals: [
        { id: 'f1', nom: 'Petit-déj', items: [{ foodId: 'pomme', nomAffiche: 'Pomme', quantite: 1, unite: 'piece', estimation: false }] },
      ],
    });
    expect(r.customFoods.map((f) => f.id)).toEqual(['pomme']);
  });

  it('promeut une estimation IA en aliment de banque, et y rattache l’item', () => {
    const entries = [entry('2026-08-01', 1, [itemIa('pastel de nata', 300)])];
    const r = migrateToPersonalBank({ entries, customFoods: [], foodOverrides: {}, favoriteMeals: [] });

    expect(r.customFoods).toHaveLength(1);
    const [f] = r.customFoods;
    expect(f.id).toBe('mine-pastel-de-nata');
    expect(f.origine).toBe('ia');
    expect(f.aVerifier).toBe(true);
    expect(f.categorie).toBe('plat');
    expect(f.n.kcal).toBe(300);

    const item = r.entries[0].items[0];
    expect(item.foodId).toBe('mine-pastel-de-nata');
    // Les valeurs vivent désormais dans la banque, plus dans l'item.
    expect(item.iaEstime).toBeUndefined();
  });

  it('dédoublonne plusieurs estimations d’un même aliment en UN seul, valeurs de la plus récente', () => {
    const entries = [
      entry('2026-08-01', 1, [itemIa('pastel de nata', 240)]),
      entry('2026-08-05', 2, [itemIa('Pastels de nata', 310)]),
    ];
    const r = migrateToPersonalBank({ entries, customFoods: [], foodOverrides: {}, favoriteMeals: [] });

    expect(r.customFoods).toHaveLength(1);
    // Dernière estimation en date = la mieux informée, et elle vaudra
    // rétroactivement pour toutes les consommations.
    expect(r.customFoods[0].n.kcal).toBe(310);
    expect(r.entries[0].items[0].foodId).toBe(r.entries[1].items[0].foodId);
  });

  it('complète les nutriments absents d’une vieille estimation (sinon : NaN à l’affichage)', () => {
    // Un `iaEstime` persisté avant l'ajout d'un nutriment ne porte que quelques
    // clés. Repéré au navigateur : « G NaN · L NaN » sur les lignes de banque.
    const partiel: JournalItem = {
      id: 'p1', foodId: null, nomAffiche: 'tarte flambée', quantite: 100, unite: 'g', grams: 100,
      nutrients: { ...EMPTY_NUTRIENTS, kcal: 250 }, estimation: false, douteux: false,
      iaEstime: { n: { kcal: 250, proteines: 9 } as Nutrients },
    };
    const r = migrateToPersonalBank({
      entries: [entry('2026-08-01', 1, [partiel])], customFoods: [], foodOverrides: {}, favoriteMeals: [],
    });
    const n = r.customFoods[0].n;
    expect(n.kcal).toBe(250);
    for (const [k, v] of Object.entries(n)) expect(Number.isFinite(v), `${k} = ${v}`).toBe(true);
  });

  it('laisse tel quel un item que rien ne résout (aucune valeur à lui donner)', () => {
    const orphelin: JournalItem = {
      id: 'x', foodId: null, nomAffiche: 'truc inconnu', quantite: 1, unite: 'piece',
      grams: 100, nutrients: { ...EMPTY_NUTRIENTS }, estimation: false, douteux: true,
    };
    const r = migrateToPersonalBank({
      entries: [entry('2026-08-01', 1, [orphelin])], customFoods: [], foodOverrides: {}, favoriteMeals: [],
    });
    expect(r.customFoods).toHaveLength(0);
    expect(r.entries[0].items[0].foodId).toBeNull();
  });

  it('NE CHANGE AUCUN TOTAL du journal — le critère d’acceptation', () => {
    const entries = [
      entry('2026-08-01', 1, [itemCatalogue('banane', 120), itemIa('pastel de nata', 300)]),
      entry('2026-08-02', 2, [itemCatalogue('pomme', 80)]),
    ];
    const avant = ['2026-08-01', '2026-08-02'].map((d) => dayTotals(entries, d));

    const r = migrateToPersonalBank({ entries, customFoods: [], foodOverrides: {}, favoriteMeals: [] });
    const resync = resyncEntries(r.entries, r.customFoods);
    const apres = ['2026-08-01', '2026-08-02'].map((d) => dayTotals(resync, d));

    expect(apres[0].kcal).toBeCloseTo(avant[0].kcal, 6);
    expect(apres[0].proteines).toBeCloseTo(avant[0].proteines, 6);
    expect(apres[1].kcal).toBeCloseTo(avant[1].kcal, 6);
  });

  it('est idempotente : la rejouer ne crée ni doublon ni changement', () => {
    const entries = [entry('2026-08-01', 1, [itemCatalogue('banane', 120), itemIa('pastel de nata', 300)])];
    const first = migrateToPersonalBank({ entries, customFoods: [], foodOverrides: {}, favoriteMeals: [] });
    const second = migrateToPersonalBank({
      entries: first.entries, customFoods: first.customFoods, foodOverrides: {}, favoriteMeals: [],
    });

    expect(second.customFoods.map((f) => f.id).sort()).toEqual(first.customFoods.map((f) => f.id).sort());
    expect(dayTotals(second.entries, '2026-08-01').kcal).toBeCloseTo(dayTotals(first.entries, '2026-08-01').kcal, 6);
  });

  it('donne un id déterministe (deux appareils convergent au lieu de dupliquer)', () => {
    expect(bankFoodId('Pastel de Nata')).toBe(bankFoodId('pastels de nata'));
    expect(bankFoodId('crème brûlée')).toBe('mine-creme-brulee');
  });
});

// ---------------------------------------------------------------------------

/** Estimation d'IA forte pour un aliment hors catalogue. */
function iaExtracted(nom: string, kcal: number): ExtractedItem {
  return {
    aliment: nom,
    quantite: 100,
    unite: 'g',
    estimation: false,
    categorie: 'plat',
    nutriments: { ...EMPTY_NUTRIENTS, kcal },
  };
}

describe('entrée dans la banque à la saisie', () => {
  beforeEach(() => {
    useStore.setState({ entries: [], customFoods: [adoptFromCatalog(banane)], favoriteMeals: [] });
  });

  it('une estimation IA fait naître un aliment « à vérifier » dans la banque', () => {
    useStore.getState().addEntry('', [iaExtracted('poke bowl saumon', 180)], 'claudecode');

    const f = useStore.getState().customFoods.find((x) => x.id === 'mine-poke-bowl-saumon')!;
    expect(f).toBeTruthy();
    expect(f.origine).toBe('ia');
    expect(f.aVerifier).toBe(true);
    expect(useStore.getState().entries[0].items[0].foodId).toBe('mine-poke-bowl-saumon');
  });

  it('la 2e occurrence réutilise les valeurs FIGÉES, sans créer de doublon', () => {
    useStore.getState().addEntry('', [iaExtracted('poke bowl saumon', 180)], 'claudecode');
    // L'IA ré-estime différemment le même plat : la banque fait foi, sinon le
    // même aliment vaudrait deux valeurs et les courbes deviendraient du bruit.
    useStore.getState().addEntry('', [iaExtracted('Poke bowls saumon', 240)], 'claudecode');

    const bank = useStore.getState().customFoods.filter((f) => f.origine === 'ia');
    expect(bank).toHaveLength(1);
    expect(bank[0].n.kcal).toBe(180);
    expect(useStore.getState().entries[0].items[0].nutrients.kcal).toBeCloseTo(180, 6);
  });

  it('un aliment déjà en banque n’est pas dupliqué par une estimation', () => {
    useStore.getState().addEntry('', [{ aliment: 'banane', quantite: 100, unite: 'g', estimation: false }], 'rules');
    expect(useStore.getState().customFoods).toHaveLength(1);
    expect(useStore.getState().entries[0].items[0].foodId).toBe('banane');
  });

  it('un ajout manuel depuis le catalogue fait entrer l’aliment dans la banque', () => {
    useStore.getState().addFoodEntry(pomme, 150, 'g');
    const ids = useStore.getState().customFoods.map((f) => f.id);
    expect(ids).toContain('pomme');
    expect(useStore.getState().entries[0].items[0].foodId).toBe('pomme');
  });
});

// ---------------------------------------------------------------------------

describe('fusion de deux aliments de la banque', () => {
  beforeEach(() => {
    useStore.setState({ entries: [], customFoods: [], favoriteMeals: [] });
  });

  it('repointe l’historique, garde le nom absorbé en synonyme et recalcule', () => {
    const s = useStore.getState();
    s.addEntry('', [iaExtracted('pastel de nata', 240)], 'claudecode');
    s.addEntry('', [iaExtracted('pasteis de nata', 310)], 'claudecode');

    const before = useStore.getState();
    expect(before.customFoods).toHaveLength(2);
    const target = before.customFoods.find((f) => f.nom === 'pastel de nata')!;
    const source = before.customFoods.find((f) => f.nom === 'pasteis de nata')!;

    const repointes = useStore.getState().mergeFoods(source.id, target.id);

    const after = useStore.getState();
    expect(repointes).toBe(1);
    expect(after.customFoods).toHaveLength(1);
    const merged = after.customFoods[0];
    expect(merged.id).toBe(target.id);
    // Sans cet alias, la prochaine dictée recréerait le doublon qu'on vient
    // tout juste de supprimer.
    expect(merged.aliases).toContain('pasteis de nata');
    // Tous les items portent maintenant les valeurs de la cible.
    for (const e of after.entries) {
      expect(e.items[0].foodId).toBe(target.id);
      expect(e.items[0].nutrients.kcal).toBeCloseTo(240, 6);
    }
  });

  it('suit aussi les repas favoris', () => {
    const s = useStore.getState();
    s.addEntry('', [iaExtracted('tarte flambee', 250)], 'claudecode');
    s.addEntry('', [iaExtracted('tarte flambée maison', 260)], 'claudecode');
    const [a, b] = useStore.getState().customFoods;
    useStore.setState({
      favoriteMeals: [
        { id: 'f1', nom: 'Soir', items: [{ foodId: b.id, nomAffiche: b.nom, quantite: 1, unite: 'portion', estimation: false }] },
      ],
    });

    useStore.getState().mergeFoods(b.id, a.id);
    expect(useStore.getState().favoriteMeals[0].items[0].foodId).toBe(a.id);
  });

  it('refuse de fusionner un aliment avec lui-même', () => {
    const foods = [adoptFromCatalog(banane)];
    const r = mergeBankFoods(foods, [], [], 'banane', 'banane');
    expect(r.customFoods).toHaveLength(1);
    expect(r.itemsRepointes).toBe(0);
  });

  it('repère les doublons probables que le nom normalisé ne rapproche pas', () => {
    const foods = [
      { ...adoptFromCatalog(banane), id: 'a', nom: 'pastel de nata' },
      { ...adoptFromCatalog(banane), id: 'b', nom: 'pasteis de nata' },
      { ...adoptFromCatalog(pomme), id: 'c', nom: 'saumon fumé' },
    ];
    const pairs = findDuplicates(foods);
    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.id, pairs[0].b.id].sort()).toEqual(['a', 'b']);
  });
});
