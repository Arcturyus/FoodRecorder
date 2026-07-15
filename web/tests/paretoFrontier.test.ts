import { describe, expect, it } from 'vitest';
import { paretoFrontier } from '../src/ui/FoodExplorer';

describe('paretoFrontier', () => {
  it('inclut TOUS les points à la valeur plancher d\'un axe minimisé, pas seulement le meilleur sur l\'autre axe', () => {
    // x = AG saturés (à minimiser), y = protéines (à maximiser).
    // Trois aliments à 0 g d'AG saturés, protéines différentes + un aliment gras très protéiné.
    const points = [
      { id: 'poulet', x: 0, y: 30 },
      { id: 'blanc-oeuf', x: 0, y: 11 },
      { id: 'crevette', x: 0, y: 20 },
      { id: 'fromage', x: 15, y: 25 }, // dominé : moins de protéines ET plus gras que poulet
    ];
    const front = paretoFrontier(points, 'min', 'max');
    const ids = front.map((p) => p.id).sort();
    // Les 3 aliments à 0 g doivent tous être conservés (indépassables sur X), le fromage dominé exclu.
    expect(ids).toEqual(['blanc-oeuf', 'crevette', 'poulet']);
  });

  it('conserve la dominance normale hors des ex æquo sur la valeur extrême', () => {
    const points = [
      { id: 'a', x: 1, y: 10 }, // meilleur x que c, moins bon y : non dominé
      { id: 'b', x: 2, y: 5 }, // dominé par a (x pire, y pire)
      { id: 'c', x: 3, y: 20 }, // meilleur y que a, moins bon x : non dominé
    ];
    const front = paretoFrontier(points, 'min', 'max');
    expect(front.map((p) => p.id).sort()).toEqual(['a', 'c']);
  });

  it('symétrique pour un objectif « max » (valeur plafond conservée)', () => {
    const points = [
      { id: 'x1', x: 100, y: 1 },
      { id: 'x2', x: 100, y: 50 },
      { id: 'x3', x: 10, y: 5 }, // dominé par x2 (x pire, y pire)
    ];
    const front = paretoFrontier(points, 'max', 'max');
    expect(front.map((p) => p.id).sort()).toEqual(['x1', 'x2']);
  });

  it('renvoie un tableau vide sans points', () => {
    expect(paretoFrontier([], 'min', 'max')).toEqual([]);
  });
});
