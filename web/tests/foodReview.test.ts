import { describe, expect, it, beforeEach } from 'vitest';
import { ficheDiff } from '../src/extraction/foodReview';
import type { ReviewFiche } from '../src/extraction/foodReview';
import { adoptFromCatalog } from '../src/nutrition/bank';
import { useStore } from '../src/store/store';
import { FOOD_BY_ID } from '../src/nutrition/foods';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { Food } from '../src/nutrition/types';

/**
 * Relecture d'un aliment par l'IA. Les appels réseau ne sont pas testés ici
 * (ils demandent une IA forte joignable) : on couvre le diff, qui décide de ce
 * que l'utilisateur voit avant d'accepter une correction rétroactive.
 */

const base: Food = {
  id: 'mine-sardines-grillees',
  nom: 'sardines grillées',
  categorie: 'poisson',
  aliases: [],
  n: { ...EMPTY_NUTRIENTS, kcal: 217, proteines: 24.6, lipides: 13.1, vitB12: 0.0089 },
};

const fiche = (n: Partial<typeof EMPTY_NUTRIENTS>): ReviewFiche => ({
  nutriments: { ...EMPTY_NUTRIENTS, ...n },
});

describe('diff d’une fiche proposée par l’IA', () => {
  it('ne liste que les nutriments qui changent vraiment', () => {
    const d = ficheDiff(base, fiche({ kcal: 249, proteines: 25.5, lipides: 16.4, vitB12: 0.0089 }));
    expect(d.map((x) => x.key).sort()).toEqual(['kcal', 'lipides', 'proteines']);
    expect(d.find((x) => x.key === 'kcal')).toMatchObject({ avant: 217, apres: 249 });
  });

  it('ignore le bruit d’arrondi sous 1 %', () => {
    // L'IA réécrit les 39 valeurs à chaque tour, la plupart à l'identique à un
    // arrondi près : sans ce filtre, le diff serait illisible.
    expect(ficheDiff(base, fiche({ kcal: 217.5, proteines: 24.6, lipides: 13.1, vitB12: 0.0089 }))).toHaveLength(0);
  });

  it('repère une valeur qui apparaît ou disparaît', () => {
    const d = ficheDiff(base, fiche({ kcal: 217, proteines: 24.6, lipides: 13.1, vitB12: 0.0089, calcium: 380 }));
    expect(d.map((x) => x.key)).toEqual(['calcium']);
    expect(d[0]).toMatchObject({ avant: 0, apres: 380 });
  });

  it('reste sensible aux micronutriments minuscules (µg)', () => {
    // 1 % de 0,0089 µg est infime : le seuil relatif doit quand même trancher.
    const d = ficheDiff(base, fiche({ kcal: 217, proteines: 24.6, lipides: 13.1, vitB12: 0.012 }));
    expect(d.map((x) => x.key)).toEqual(['vitB12']);
  });

  it('renvoie un diff vide quand l’IA propose exactement les valeurs actuelles', () => {
    expect(ficheDiff(base, fiche(base.n))).toHaveLength(0);
  });

  it('nomme TOUS les nutriments, y compris ceux absents de la table AJR', () => {
    // Les oméga 3 détaillés n'ont pas de cible propre : sans la table de secours,
    // le diff afficherait « omega3Ala » à l'utilisateur.
    const d = ficheDiff(base, fiche({ ...base.n, omega3Ala: 0.1, omega3Epa: 0.7, omega3Dha: 0.9 }));
    expect(d).toHaveLength(3);
    for (const x of d) expect(x.label, x.key).not.toBe(x.key);
  });
});

describe('reclassement groupé (setFoodCategories)', () => {
  beforeEach(() => {
    useStore.setState({
      entries: [],
      favoriteMeals: [],
      customFoods: [
        { ...adoptFromCatalog(FOOD_BY_ID.get('banane')!), categorie: 'autre' },
        { ...base, aVerifier: true, categorie: 'autre', origine: 'ia' },
      ],
    });
  });

  it('range les aliments et compte ceux qui ont bougé', () => {
    const n = useStore.getState().setFoodCategories({ banane: 'fruit', 'mine-sardines-grillees': 'poisson' });
    expect(n).toBe(2);
    expect(useStore.getState().customFoods.find((f) => f.id === 'banane')!.categorie).toBe('fruit');
  });

  it('ne compte pas un aliment déjà dans la bonne catégorie', () => {
    useStore.getState().setFoodCategories({ banane: 'fruit' });
    expect(useStore.getState().setFoodCategories({ banane: 'fruit' })).toBe(0);
  });

  it('NE lève PAS le drapeau « à vérifier » — classer n’est pas relire les valeurs', () => {
    useStore.getState().setFoodCategories({ 'mine-sardines-grillees': 'poisson' });
    expect(useStore.getState().customFoods.find((f) => f.id === 'mine-sardines-grillees')!.aVerifier).toBe(true);
  });

  it('ignore un id inconnu', () => {
    expect(useStore.getState().setFoodCategories({ 'mine-inexistant': 'plat' })).toBe(0);
  });
});
