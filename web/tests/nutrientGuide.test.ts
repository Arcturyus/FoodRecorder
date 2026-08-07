import { describe, it, expect } from 'vitest';
import { RDA } from '../src/nutrition/rda';
import { NUTRIENT_GUIDE } from '../src/nutrition/guide';
import { computeTargets, DEFAULT_PROFILE } from '../src/nutrition/targets';

/**
 * Le guide est du CONTENU : rien ne casse à la compilation si un nutriment y est
 * oublié — il s'affichera simplement sans explication, en silence. Ces tests
 * sont donc le seul garde-fou : ajouter une ligne à `RDA` sans écrire son guide
 * doit faire échouer la suite.
 */
describe('guide par nutriment', () => {
  it('couvre TOUS les nutriments de RDA, sans entrée orpheline', () => {
    const manquants = RDA.filter((r) => !NUTRIENT_GUIDE[r.key]).map((r) => r.key);
    expect(manquants).toEqual([]);

    const connus = new Set(RDA.map((r) => r.key));
    const orphelins = Object.keys(NUTRIENT_GUIDE).filter((k) => !connus.has(k as never));
    expect(orphelins).toEqual([]);
  });

  it('répond aux quatre questions pour chaque nutriment', () => {
    for (const r of RDA) {
      const g = NUTRIENT_GUIDE[r.key]!;
      for (const [champ, texte] of [
        ['low', g.low],
        ['role', g.role],
        ['higher', g.higher],
        ['evidence', g.evidence.text],
      ] as const) {
        // Une phrase creuse (« voir plus haut ») serait pire que rien : le seuil
        // de 40 caractères attrape les remplissages sans exiger de longueur.
        expect(texte.length, `${r.key}.${champ}`).toBeGreaterThan(40);
      }
    }
  });

  it("cite une quantité dans le bloc « trop bas » — c'est tout l'intérêt", () => {
    for (const r of RDA) {
      const g = NUTRIENT_GUIDE[r.key]!;
      // Un chiffre, ou l'affirmation explicite qu'il n'y a pas de seuil bas
      // (acides gras que le corps fabrique, nutriments non essentiels).
      const chiffre = /\d/.test(g.low);
      const sansSeuil = /aucun besoin|aucune carence|pas de carence|n'existe pas de carence|il n'existe pas de glucide/i.test(g.low);
      expect(chiffre || sansSeuil, `${r.key}.low`).toBe(true);
    }
  });
});

describe('seuils hauts', () => {
  it('ordonne cible < prudence < effets observés', () => {
    for (const t of computeTargets(DEFAULT_PROFILE)) {
      // Pour une limite, la « cible » à dépasser est le plafond (ajr) ;
      // pour un nutriment à couvrir, c'est l'optimal.
      const cible = t.goal === 'limit' ? t.ajr : t.optimal;
      if (t.upper != null) expect(t.upper, `${t.key}: upper > cible`).toBeGreaterThan(cible);
      if (t.toxic != null && t.upper != null) {
        expect(t.toxic, `${t.key}: toxic > upper`).toBeGreaterThan(t.upper);
      }
      if (t.toxic != null && t.upper == null) {
        expect(t.toxic, `${t.key}: toxic > cible`).toBeGreaterThan(cible);
      }
    }
  });

  it('donne des seuils protéiques proportionnels au poids', () => {
    const leger = computeTargets({ ...DEFAULT_PROFILE, poids: 50 }).find((t) => t.key === 'proteines')!;
    const lourd = computeTargets({ ...DEFAULT_PROFILE, poids: 100 }).find((t) => t.key === 'proteines')!;
    expect(leger.upper).toBe(175); // 3,5 g/kg
    expect(lourd.upper).toBe(350);
    expect(lourd.toxic).toBe(450); // 4,5 g/kg
  });

  it("n'invente pas de seuil pour les nutriments sans excès connu", () => {
    // Vitamines hydrosolubles éliminées par le rein, vitamine K : pas de limite
    // officielle. Leur en donner une ferait apparaître une barre d'excès mensongère.
    const targets = computeTargets(DEFAULT_PROFILE);
    for (const key of ['vitB1', 'vitB2', 'vitB5', 'vitB12', 'vitK1', 'vitK2'] as const) {
      const t = targets.find((x) => x.key === key)!;
      expect(t.upper, `${key} ne doit pas avoir de seuil de prudence`).toBeUndefined();
    }
  });
});
