import { describe, expect, it } from 'vitest';
import { matchFood } from '../src/nutrition/match';

/**
 * ≥ 40 aliments FR courants (dont pièges). Critère plan §Phase 1 : ≥ 90 % top-1.
 */
const CASES: [input: string, expectedId: string][] = [
  ['banane', 'banane'],
  ['une pomme', 'pomme'],
  ['abricots', 'abricot'],
  ['pêche', 'peche'],
  ['des oranges', 'orange'],
  ['cerises', 'cerise'],
  ['mangue', 'mangue'],
  ['kiwi', 'kiwi'],
  ['fraises', 'fraise'],
  ['avocat', 'avocat'],
  ['raisins', 'raisin'],
  ['ananas', 'ananas'],
  ['melon', 'melon'],
  ['tomates', 'tomate'],
  ['haricots verts', 'haricots-verts'],
  ['carottes râpées', 'carotte'],
  ['brocolis', 'brocoli'],
  ['épinards', 'epinards'],
  ['salade verte', 'salade'],
  ['champignons', 'champignon'],
  ['pommes de terre', 'pomme-de-terre'],
  ['riz', 'riz-blanc'],
  ['riz basmati', 'riz-blanc'],
  ['des pâtes', 'pates'],
  ['spaghettis', 'pates'],
  ['pâtes complètes', 'pates-completes'],
  ['pain', 'baguette'],
  ['pain complet', 'pain-complet'],
  ['quinoa', 'quinoa'],
  ['lentilles', 'lentilles'],
  ['frites', 'frites'],
  ['steak haché 5%', 'steak-hache-5'],
  ['steak haché', 'steak-hache-15'],
  ['filet de poulet', 'filet-poulet'],
  ['blanc de poulet', 'filet-poulet'],
  ['cuisse de poulet', 'cuisse-poulet'],
  ['jambon', 'jambon-blanc'],
  ['saumon', 'saumon'],
  ['thon', 'thon-boite'],
  ['cabillaud', 'cabillaud'],
  ['crevettes', 'crevettes'],
  ['oeuf', 'oeuf'],
  ['deux œufs', 'oeuf'],
  ['yaourt nature', 'yaourt-nature'],
  ['yaourt', 'yaourt-nature'],
  ['fromage blanc', 'fromage-blanc'],
  ['fromage blanc 0%', 'fromage-blanc-0'],
  ['lait', 'lait-demi'],
  ['emmental', 'emmental'],
  ['fromage râpé', 'emmental'],
  ['camembert', 'camembert'],
  ['mozzarella', 'mozzarella'],
  ['beurre', 'beurre'],
  ['chocolat noir', 'chocolat-noir-85'],
  ['chocolat au lait', 'chocolat-lait'],
  ['chocolat noir 85%', 'chocolat-noir-85'],
  ['petits gâteaux', 'petit-beurre'],
  ['croissant', 'croissant'],
  ['amandes', 'amandes'],
  ['noix', 'noix'],
  ['pizza', 'pizza'],
];

describe('matchFood', () => {
  it(`matche ≥ 90% des ${CASES.length} aliments courants en top-1`, () => {
    const misses: string[] = [];
    for (const [input, expected] of CASES) {
      const res = matchFood(input);
      if (res.food?.id !== expected) {
        misses.push(`"${input}" → ${res.food?.id ?? 'null'} (attendu ${expected})`);
      }
    }
    const rate = (CASES.length - misses.length) / CASES.length;
    if (rate < 0.9) {
      throw new Error(`Taux top-1 = ${(rate * 100).toFixed(1)}%\n${misses.join('\n')}`);
    }
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it('signale les aliments inconnus comme douteux', () => {
    const res = matchFood('xyzzy blorptron');
    expect(res.douteux).toBe(true);
  });

  it('propose des alternatives', () => {
    const res = matchFood('poulet');
    expect(res.alternatives.length).toBeGreaterThan(0);
  });
});
