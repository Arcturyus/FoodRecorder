import { describe, expect, it } from 'vitest';
import { categoryPairs } from '../src/ui/FoodCompare';
import type { BankUsage } from '../src/ui/useBankUsage';
import { EMPTY_NUTRIENTS, type Food, type FoodCategory } from '../src/nutrition/types';

/**
 * Les comparaisons proposées quand « Comparer » est encore vide. Ce qui compte
 * ici n'est pas la nutrition mais le CHOIX des paires : de vrais substituts
 * (même famille), tirés de ce qui est réellement mangé.
 */

function food(id: string, categorie: FoodCategory): Food {
  return { id, nom: id, categorie, aliases: [], n: { ...EMPTY_NUTRIENTS } };
}

function usage(entries: Record<string, number>): Map<string, BankUsage> {
  return new Map(
    Object.entries(entries).map(([id, jours]) => [id, { jours, occurrences: jours, derniere: '2026-08-20' }]),
  );
}

describe('categoryPairs', () => {
  it('apparie les deux aliments les plus fréquents de chaque famille', () => {
    const foods = [
      food('saumon', 'poisson'),
      food('cabillaud', 'poisson'),
      food('sardine', 'poisson'),
      food('riz', 'feculent'),
      food('pates', 'feculent'),
    ];
    const pairs = categoryPairs(foods, usage({ saumon: 24, cabillaud: 11, sardine: 3, riz: 31, pates: 18 }));
    expect(pairs).toHaveLength(2);
    // Féculents d'abord : 31 + 18 pèse plus que 24 + 11.
    expect(pairs[0].a.id).toBe('riz');
    expect(pairs[0].b.id).toBe('pates');
    expect(pairs[1].a.id).toBe('saumon');
    expect(pairs[1].b.id).toBe('cabillaud');
    // La sardine, troisième de sa famille, ne fait pas de paire.
    expect(pairs.flatMap((p) => [p.a.id, p.b.id])).not.toContain('sardine');
  });

  it('nomme la famille et les jours dans la raison affichée', () => {
    const foods = [food('saumon', 'poisson'), food('cabillaud', 'poisson')];
    const [pair] = categoryPairs(foods, usage({ saumon: 24, cabillaud: 11 }));
    expect(pair.why).toBe('poissons · 24 j / 11 j');
  });

  it('ignore une famille qui ne compte qu’un seul aliment mangé', () => {
    const foods = [food('riz', 'feculent'), food('pates', 'feculent')];
    // Les pâtes n'ont jamais été mangées : pas de paire possible.
    expect(categoryPairs(foods, usage({ riz: 31 }))).toEqual([]);
  });

  it('écarte les compléments — « whey vs créatine » n’est pas un repas', () => {
    const foods = [food('whey', 'supplement'), food('creatine', 'supplement')];
    expect(categoryPairs(foods, usage({ whey: 40, creatine: 38 }))).toEqual([]);
  });

  it('ne rend que les `limit` meilleures paires', () => {
    const foods = [
      food('saumon', 'poisson'),
      food('cabillaud', 'poisson'),
      food('riz', 'feculent'),
      food('pates', 'feculent'),
      food('pomme', 'fruit'),
      food('banane', 'fruit'),
    ];
    const u = usage({ saumon: 24, cabillaud: 11, riz: 31, pates: 18, pomme: 9, banane: 8 });
    expect(categoryPairs(foods, u, 2)).toHaveLength(2);
    expect(categoryPairs(foods, u).map((p) => p.a.id)).toEqual(['riz', 'saumon', 'pomme']);
  });
});
