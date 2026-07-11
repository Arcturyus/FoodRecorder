import { describe, expect, it } from 'vitest';
import { parseTranscript } from '../src/extraction/ruleParser';
import { computeItems, totalNutrients } from '../src/nutrition/compute';
import { FOODS } from '../src/nutrition/foods';

interface ParseCase {
  phrase: string;
  attendu: { aliment?: string; quantite?: number; unite?: string }[];
}

/** ≥ 30 phrases : quantités explicites, implicites, orales. Critère plan §Phase 3. */
const CASES: ParseCase[] = [
  { phrase: 'un bol de riz', attendu: [{ quantite: 1, unite: 'bol' }] },
  { phrase: '150 g de poulet', attendu: [{ quantite: 150, unite: 'g' }] },
  { phrase: 'deux œufs', attendu: [{ quantite: 2, unite: 'piece' }] },
  { phrase: 'trois abricots', attendu: [{ quantite: 3, unite: 'piece' }] },
  { phrase: 'une banane', attendu: [{ quantite: 1, unite: 'piece' }] },
  { phrase: 'du riz', attendu: [{ unite: 'portion' }] },
  { phrase: 'de la salade', attendu: [{ unite: 'portion' }] },
  { phrase: '200 grammes de pâtes', attendu: [{ quantite: 200, unite: 'g' }] },
  { phrase: 'un verre de lait', attendu: [{ quantite: 1, unite: 'verre' }] },
  { phrase: 'deux tranches de jambon', attendu: [{ quantite: 2, unite: 'tranche' }] },
  { phrase: 'trois carrés de chocolat noir', attendu: [{ quantite: 3, unite: 'carre' }] },
  { phrase: 'une cuillère à soupe d\'huile d\'olive', attendu: [{ quantite: 1, unite: 'cas' }] },
  { phrase: 'deux cuillères à café de miel', attendu: [{ quantite: 2, unite: 'cac' }] },
  { phrase: 'une poignée d\'amandes', attendu: [{ quantite: 1, unite: 'poignee' }] },
  { phrase: 'un demi avocat', attendu: [{ quantite: 0.5, unite: 'piece' }] },
  { phrase: 'une demi-baguette', attendu: [{ quantite: 0.5, unite: 'piece' }] },
  { phrase: '250 ml de lait', attendu: [{ quantite: 250, unite: 'ml' }] },
  { phrase: '1 kg de pommes de terre', attendu: [{ quantite: 1000, unite: 'g' }] },
  { phrase: 'un pot de fromage blanc', attendu: [{ quantite: 1, unite: 'pot' }] },
  { phrase: 'une assiette de pâtes', attendu: [{ quantite: 1, unite: 'assiette' }] },
  // plusieurs aliments
  {
    phrase: 'un bol de riz avec 150 g de poulet et un yaourt nature',
    attendu: [{ unite: 'bol' }, { quantite: 150, unite: 'g' }, { unite: 'piece' }],
  },
  {
    phrase: 'deux œufs, une banane et du fromage blanc',
    attendu: [{ quantite: 2 }, { quantite: 1 }, {}],
  },
  {
    phrase: '100 g de pâtes avec du fromage râpé et une tomate',
    attendu: [{ quantite: 100, unite: 'g' }, {}, { quantite: 1 }],
  },
  // formulations orales avec fillers
  { phrase: "euh j'ai mangé genre une pomme", attendu: [{ quantite: 1 }] },
  { phrase: 'ce matin j\'ai pris deux tranches de pain complet', attendu: [{ quantite: 2, unite: 'tranche' }] },
  { phrase: 'à peu près 200 g de saumon', attendu: [{ quantite: 200, unite: 'g' }] },
  { phrase: 'bah du poulet quoi', attendu: [{ unite: 'portion' }] },
  { phrase: 'j\'ai bu un verre de jus d\'orange', attendu: [{ quantite: 1, unite: 'verre' }] },
  { phrase: 'une poignée de chips', attendu: [{ quantite: 1, unite: 'poignee' }] },
  { phrase: 'quatre carrés de chocolat', attendu: [{ quantite: 4, unite: 'carre' }] },
  { phrase: 'une part de pizza', attendu: [{ quantite: 1, unite: 'piece' }] },
  { phrase: 'un avocat', attendu: [{ quantite: 1, unite: 'piece' }] },
];

describe('parseTranscript', () => {
  it(`extrait correctement ≥ 85% des ${CASES.length} phrases`, () => {
    const fails: string[] = [];
    for (const c of CASES) {
      const items = parseTranscript(c.phrase);
      if (items.length !== c.attendu.length) {
        fails.push(`"${c.phrase}" → ${items.length} items (attendu ${c.attendu.length})`);
        continue;
      }
      for (let i = 0; i < c.attendu.length; i++) {
        const exp = c.attendu[i];
        const got = items[i];
        if (exp.quantite !== undefined && Math.abs(got.quantite - exp.quantite) > 0.001) {
          fails.push(`"${c.phrase}" item ${i}: quantité ${got.quantite} (attendu ${exp.quantite})`);
        }
        if (exp.unite !== undefined && got.unite !== exp.unite) {
          fails.push(`"${c.phrase}" item ${i}: unité ${got.unite} (attendu ${exp.unite})`);
        }
      }
    }
    const rate = (CASES.length - new Set(fails.map((f) => f.split('"')[1])).size) / CASES.length;
    if (rate < 0.85) throw new Error(`Taux = ${(rate * 100).toFixed(1)}%\n${fails.join('\n')}`);
    expect(rate).toBeGreaterThanOrEqual(0.85);
  });

  it('extrait, matche et calcule un repas complet de bout en bout', () => {
    const items = parseTranscript('un bol de riz avec 150 g de filet de poulet et un yaourt nature');
    const computed = computeItems(items, FOODS);
    expect(computed).toHaveLength(3);
    expect(computed.every((c) => c.match.food !== null)).toBe(true);
    const totals = totalNutrients(computed);
    // riz (~200g) + poulet 150g + yaourt 125g → repas plausible 400-750 kcal
    expect(totals.kcal).toBeGreaterThan(400);
    expect(totals.kcal).toBeLessThan(800);
    expect(totals.proteines).toBeGreaterThan(40); // poulet riche en protéines
  });
});
