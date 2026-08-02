/**
 * Ajustement « pour cette fois » d'un aliment du journal. Le piège : le
 * formulaire reconstruit l'apport COMPLET de l'item à partir des cases
 * affichées, donc tout nutriment absent de la liste repartait à 0 — la
 * répartition des AG saturés (C16+C14 / stéarique) et celle des oméga 3
 * disparaissaient dès qu'on corrigeait les calories d'un aliment.
 */

import { describe, expect, it } from 'vitest';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { NutrientKey } from '../src/nutrition/types';
import { computeTargets, DEFAULT_PROFILE } from '../src/nutrition/targets';
import { DETAIL_GROUPS, draftToContribution, nutrientsToDraft } from '../src/ui/itemDetail';

/** Beurre : riche en AG saturés, donc avec une répartition à préserver. */
const beurre = {
  ...EMPTY_NUTRIENTS,
  kcal: 150,
  lipides: 17,
  agSatures: 11,
  agSaturesLdl: 7,
  agSaturesStearique: 2,
  omega3: 0.3,
  omega3Ala: 0.3,
  collagene: 0,
};

describe('liste des nutriments du détail', () => {
  it('couvre TOUTE clé de Nutriments (sinon elle serait effacée à l’ajustement)', () => {
    const listed = new Set(DETAIL_GROUPS.flatMap((g) => g.keys));
    const missing = (Object.keys(EMPTY_NUTRIENTS) as NutrientKey[]).filter((k) => !listed.has(k));
    expect(missing).toEqual([]);
  });

  it('n’annonce aucune clé inconnue et ne répète rien', () => {
    const keys = DETAIL_GROUPS.flatMap((g) => g.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(EMPTY_NUTRIENTS).toHaveProperty(k);
  });

  it('les sous-parts suivent immédiatement leur parent', () => {
    const targets = new Map(computeTargets(DEFAULT_PROFILE).map((t) => [t.key, t]));
    for (const g of DETAIL_GROUPS) {
      g.keys.forEach((k, i) => {
        const parent = targets.get(k)?.parent;
        if (!parent) return;
        // Le précédent est soit le parent lui-même, soit une autre sous-part du même parent.
        const prev = g.keys[i - 1];
        expect(prev === parent || targets.get(prev)?.parent === parent).toBe(true);
      });
    }
  });
});

describe('ajustement pour cette fois', () => {
  it('préserve la répartition des AG saturés quand on ne corrige que les kcal', () => {
    const draft = { ...nutrientsToDraft(beurre), kcal: '120' };
    const out = draftToContribution(beurre, draft);
    expect(out.kcal).toBe(120);
    expect(out.agSaturesLdl).toBe(7);
    expect(out.agSaturesStearique).toBe(2);
    expect(out.omega3Ala).toBeCloseTo(0.3, 5);
  });

  it('préserve un nutriment absent de la liste affichée (le bug d’origine)', () => {
    // Groupes volontairement incomplets = l'état du code avant correction, et
    // ce qui arriverait à un nutriment ajouté au modèle sans être listé ici.
    const partiels = [{ keys: ['kcal', 'lipides'] as NutrientKey[] }];
    const out = draftToContribution(beurre, { ...nutrientsToDraft(beurre), kcal: '120' }, partiels);
    expect(out.kcal).toBe(120);
    expect(out.agSaturesLdl).toBe(7);
    expect(out.agSaturesStearique).toBe(2);
  });

  it('vider une case met bien le nutriment à zéro (correction volontaire)', () => {
    const out = draftToContribution(beurre, { ...nutrientsToDraft(beurre), agSaturesStearique: '' });
    expect(out.agSaturesStearique).toBe(0);
    expect(out.agSaturesLdl).toBe(7);
  });

  it('accepte la virgule décimale', () => {
    const out = draftToContribution(beurre, { ...nutrientsToDraft(beurre), fer: '1,5' });
    expect(out.fer).toBe(1.5);
  });
});
