import { describe, expect, it } from 'vitest';
import { topSourcesFor, macroAdvice, DAY_FOOD_SUGGESTIONS, MACRO_MAX_SUGGESTIONS, SUGGESTION_PAGES } from '../src/nutrition/recommend';
import { computeTargets, DEFAULT_PROFILE } from '../src/nutrition/targets';
import { FOODS } from '../src/nutrition/foods';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';

/**
 * « Aucune des propositions ne me va » : les conseils du jour préparent
 * plusieurs pages d'aliments d'avance, que l'écran fait tourner. On vérifie ici
 * qu'il y a bien de quoi tourner, sans doublon, et que la garantie « au moins un
 * aliment déjà mangé » porte sur la PREMIÈRE page (la seule visible).
 */

const targets = computeTargets(DEFAULT_PROFILE);

describe('pages de suggestions — conseils du jour', () => {
  it('topSourcesFor prépare plusieurs pages sans doublon', () => {
    const sources = topSourcesFor('fer', 14, FOODS, {
      supplements: false,
      limit: DAY_FOOD_SUGGESTIONS * SUGGESTION_PAGES,
      pageSize: DAY_FOOD_SUGGESTIONS,
    });
    expect(sources.length).toBeGreaterThan(DAY_FOOD_SUGGESTIONS);
    expect(new Set(sources.map((s) => s.food.id)).size).toBe(sources.length);
  });

  it('la première page contient un aliment déjà mangé, sans le dupliquer plus loin', () => {
    // Un aliment volontairement médiocre en fer : sans la garantie, il ne
    // remonterait jamais dans les 4 premiers.
    const known = FOODS.find((f) => f.categorie !== 'supplement' && f.n.fer > 0 && f.n.fer < 1)!;
    const sources = topSourcesFor('fer', 14, FOODS, {
      supplements: false,
      limit: DAY_FOOD_SUGGESTIONS * SUGGESTION_PAGES,
      pageSize: DAY_FOOD_SUGGESTIONS,
      consumedIds: new Set([known.id]),
    });
    const firstPage = sources.slice(0, DAY_FOOD_SUGGESTIONS);
    expect(firstPage.some((s) => s.food.id === known.id)).toBe(true);
    expect(sources.filter((s) => s.food.id === known.id)).toHaveLength(1);
  });

  it('la section macros propose de quoi alimenter plusieurs pages', () => {
    // Journée à mi-parcours : calories entamées, protéines très en retard.
    const totals = { ...EMPTY_NUTRIENTS, kcal: 1200, proteines: 30 };
    const macro = macroAdvice(totals, targets, FOODS)!;
    expect(macro).not.toBeNull();
    expect(macro.suggestions.length).toBeGreaterThan(MACRO_MAX_SUGGESTIONS);
    expect(new Set(macro.suggestions.map((s) => s.food.id)).size).toBe(macro.suggestions.length);
  });

  it('un aliment déjà mangé remonte dans la première page des macros', () => {
    const totals = { ...EMPTY_NUTRIENTS, kcal: 1200, proteines: 30 };
    // Un aliment qui, sans historique, tombe au-delà de la première page.
    const later = macroAdvice(totals, targets, FOODS)!.suggestions[MACRO_MAX_SUGGESTIONS + 1].food;

    const macro = macroAdvice(totals, targets, FOODS, new Set([later.id]))!;
    const firstPage = macro.suggestions.slice(0, MACRO_MAX_SUGGESTIONS);
    expect(firstPage.some((s) => s.food.id === later.id)).toBe(true);
    // Remonté, pas dupliqué : il ne réapparaît pas dans les pages suivantes.
    expect(macro.suggestions.filter((s) => s.food.id === later.id)).toHaveLength(1);
  });
});
