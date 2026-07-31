/**
 * Répartition des AG saturés : le point de la fonctionnalité est qu'un même
 * chiffre d'« AG saturés » recouvre des acides gras qui n'ont pas le même effet.
 * Ces tests verrouillent l'invariant (les sous-parts ne dépassent jamais le
 * total) et le cas emblématique (chocolat noir majoritairement stéarique).
 */

import { describe, expect, it } from 'vitest';
import { FOODS, FOOD_BY_ID, splitSaturated } from '../src/nutrition/foods';
import { RDA } from '../src/nutrition/rda';
import { computeTargets, DEFAULT_PROFILE } from '../src/nutrition/targets';
import { validateExtraction } from '../src/extraction/schema';

describe('répartition des AG saturés dans la banque', () => {
  it('aucun aliment n’a des sous-parts supérieures à son total', () => {
    const fautifs = FOODS.filter(
      // Marge de 1 % : les parts sont arrondies à 2 décimales.
      (f) => f.n.agSaturesLdl + f.n.agSaturesStearique > f.n.agSatures * 1.01 + 0.001,
    ).map((f) => f.id);
    expect(fautifs).toEqual([]);
  });

  it('tout aliment qui a des AG saturés a une répartition (pas de trou)', () => {
    const sansDetail = FOODS.filter((f) => f.n.agSatures > 0.05 && f.n.agSaturesLdl + f.n.agSaturesStearique <= 0).map((f) => f.id);
    expect(sansDetail).toEqual([]);
  });

  it('le chocolat noir est majoritairement STÉARIQUE (le cas qui justifie tout)', () => {
    const choco = FOOD_BY_ID.get('chocolat-noir-85')!;
    expect(choco.n.agSaturesStearique).toBeGreaterThan(choco.n.agSaturesLdl);
  });

  it('le beurre est à l’inverse dominé par le palmitique + myristique', () => {
    const beurre = FOOD_BY_ID.get('beurre')!;
    expect(beurre.n.agSaturesLdl).toBeGreaterThan(beurre.n.agSaturesStearique * 2);
  });

  it('un aliment sans profil dédié suit le profil de sa catégorie', () => {
    const { agSaturesLdl, agSaturesStearique } = splitSaturated(10, 'viande');
    expect(agSaturesLdl).toBeCloseTo(6.6, 5);
    expect(agSaturesStearique).toBeCloseTo(3.1, 5);
  });

  it('sans AG saturés, la répartition est nulle', () => {
    expect(splitSaturated(0, 'fruit')).toEqual({ agSaturesLdl: 0, agSaturesStearique: 0 });
  });
});

describe('cibles', () => {
  const targets = computeTargets(DEFAULT_PROFILE);
  const get = (key: string) => targets.find((t) => t.key === key)!;

  it('le plafond qui compte porte sur C16+C14, pas sur le total', () => {
    expect(get('agSaturesLdl').ajr).toBe(16);
    expect(get('agSaturesLdl').optimal).toBe(11);
    // Le total n'est plus qu'un filet de sécurité, nettement plus haut.
    expect(get('agSatures').ajr).toBe(30);
  });

  it('le stéarique a un repère haut et souple', () => {
    expect(get('agSaturesStearique').ajr).toBe(18);
  });

  it('les sous-détails sont rattachés à leur parent (pas de tuile propre)', () => {
    expect(get('agSaturesLdl').parent).toBe('agSatures');
    expect(get('agSaturesStearique').parent).toBe('agSatures');
    expect(get('agSatures').parent).toBeUndefined();
  });

  it('le total pèse moins que le détail, pour ne pas pénaliser deux fois', () => {
    const imp = (k: string) => RDA.find((r) => r.key === k)!.importance ?? 1;
    expect(imp('agSatures')).toBeLessThan(imp('agSaturesLdl'));
  });
});

describe('estimation IA', () => {
  it('complète la répartition quand l’IA a donné le total sans le détail', () => {
    const items = validateExtraction({
      items: [
        {
          aliment: 'pastel de nata',
          quantite: 1,
          unite: 'piece',
          estimation: true,
          categorie: 'sucre-snack',
          nutriments: { kcal: 298, agSatures: 6 },
        },
      ],
    })!;
    const n = items[0].nutriments!;
    expect(n.agSaturesLdl).toBeGreaterThan(0);
    expect(n.agSaturesStearique).toBeGreaterThan(0);
    expect(n.agSaturesLdl + n.agSaturesStearique).toBeLessThanOrEqual(n.agSatures);
  });

  it('respecte la répartition quand l’IA la fournit', () => {
    const items = validateExtraction({
      items: [
        {
          aliment: 'tablette artisanale 90 %',
          quantite: 30,
          unite: 'g',
          estimation: false,
          categorie: 'sucre-snack',
          nutriments: { kcal: 600, agSatures: 30, agSaturesLdl: 12, agSaturesStearique: 17 },
        },
      ],
    })!;
    expect(items[0].nutriments!.agSaturesStearique).toBe(17);
  });
});
