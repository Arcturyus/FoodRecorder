import { describe, expect, it } from 'vitest';
import { matchFood } from '../src/nutrition/match';
import { FOODS } from '../src/nutrition/foods';
import { STRONG_DB_MATCH } from '../src/nutrition/compute';

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
      const res = matchFood(input, FOODS);
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
    const res = matchFood('xyzzy blorptron', FOODS);
    expect(res.douteux).toBe(true);
  });

  it('propose des alternatives', () => {
    const res = matchFood('poulet', FOODS);
    expect(res.alternatives.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Les mots de forme sont des aliments, pas du décor
// ---------------------------------------------------------------------------

/**
 * Un filet de poulet (165 kcal), une cuisse (215) et une aile (290) ne sont pas
 * le même aliment. Le matching a longtemps traité « filet / cuisse / aile /
 * escalope / pavé » comme des mots de présentation à poids réduit, retirés avant
 * le calcul de similarité : « cuisse de poulet » ressortait alors sur le FILET
 * avec un score de 0,98 — au-dessus de STRONG_DB_MATCH, donc sans même passer par
 * la 2e passe de l'IA (cf. extraction/verify.ts). L'erreur était silencieuse.
 *
 * Ces cas sont testés un par un, et non noyés dans le taux global ci-dessus : un
 * taux de 90 % laisse justement passer quatre confusions sur quarante.
 */
describe('découpes : filet ≠ cuisse ≠ aile', () => {
  const COUPES: [input: string, expectedId: string][] = [
    ['filet de poulet', 'filet-poulet'],
    ['blanc de poulet', 'filet-poulet'],
    ['cuisse de poulet', 'cuisse-poulet'],
    ['cuisses de poulet', 'cuisse-poulet'],
    ['aile de poulet', 'aile-poulet'],
    ['ailes de poulet', 'aile-poulet'],
  ];

  it.each(COUPES)('« %s » → %s', (input, expectedId) => {
    expect(matchFood(input, FOODS).food?.id).toBe(expectedId);
  });

  it('tolère toujours une faute de frappe', () => {
    // Le fuzzy plein texte doit survivre au durcissement : sinon on force un
    // aller-retour IA sur une simple coquille.
    expect(matchFood('cuise de poulet', FOODS).food?.id).toBe('cuisse-poulet');
    expect(matchFood('filet de poullet', FOODS).food?.id).toBe('filet-poulet');
  });
});

/**
 * L'app ne garde la valeur de la base sans avis de l'IA qu'au-dessus de
 * STRONG_DB_MATCH (cf. nutrition/compute.ts). Ces libellés désignent autre chose
 * que ce que la base propose de plus proche : ils DOIVENT rester sous le seuil,
 * pour que `verifyMatches` les soumette à l'IA, qui en refera un aliment estimé.
 */
describe('les aliments distincts restent sous le seuil « quasi exact »', () => {
  const PIEGES = [
    'steak de thon',
    'tarte aux myrtilles',
    'gâteau au chocolat',
    'poulet tikka masala',
    'nuggets de poulet',
    'brochette de poulet',
    'jambon de dinde',
    'boulettes de boeuf',
    'escalope de veau',
    // « escalope de poulet » n'est plus un alias déclaré du filet : à l'IA de dire
    // si la découpe change quelque chose (cf. aliases de filet-poulet dans foods.ts).
    'escalope de poulet',
    'poulet',
  ];

  it.each(PIEGES)("« %s » n'est pas donné pour un aliment de la base", (input) => {
    expect(matchFood(input, FOODS).score).toBeLessThan(STRONG_DB_MATCH);
  });
});

// ---------------------------------------------------------------------------
// Départage des hésitations par la consommation récente
// ---------------------------------------------------------------------------

import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { Food } from '../src/nutrition/types';

function mkFood(id: string, nom: string, aliases: string[] = []): Food {
  return { id, nom, categorie: 'oeuf-laitier', aliases, n: { ...EMPTY_NUTRIENTS } };
}

describe('départage par consommation récente (recentCounts)', () => {
  const fb0 = mkFood('fb0', 'fromage blanc 0%', ['fromage blanc']);
  const fb3 = mkFood('fb3', 'fromage blanc 3%', ['fromage blanc']);
  const skyr = mkFood('skyr', 'skyr', []);
  const bank = [fb0, fb3, skyr];

  it('sans historique, garde le meilleur score (ordre de la banque)', () => {
    const res = matchFood('fromage blanc', bank);
    expect(res.food?.id).toBe('fb0');
  });

  it('à scores équivalents, choisit le plus mangé les derniers jours', () => {
    const res = matchFood('fromage blanc', bank, new Map([['fb3', 5]]));
    expect(res.food?.id).toBe('fb3');
  });

  it("ne détourne pas une demande explicite vers l'habitude", () => {
    const res = matchFood('fromage blanc 0%', bank, new Map([['fb3', 12]]));
    expect(res.food?.id).toBe('fb0');
  });

  it("l'aliment écarté reste proposé en alternative", () => {
    const res = matchFood('fromage blanc', bank, new Map([['fb3', 5]]));
    expect(res.alternatives.map((f) => f.id)).toContain('fb0');
  });
});
