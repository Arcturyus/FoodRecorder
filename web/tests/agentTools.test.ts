import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import { findTool, READ_TOOLS } from '../src/agent/tools';
import { useStore, type JournalEntry } from '../src/store/store';
import type { SunExposure } from '../src/sun/vitaminD';

function entry(date: string, proteines: number): JournalEntry {
  return {
    id: `e-${date}`,
    date,
    createdAt: new Date(`${date}T12:00:00`).getTime(),
    transcript: `${proteines} g de protéines`,
    source: 'manuel',
    items: [{
      id: `i-${date}`, foodId: null, nomAffiche: 'aliment test', quantite: 100,
      unite: 'g', grams: 100, nutrients: { ...EMPTY_NUTRIENTS, proteines },
      estimation: false, douteux: false,
    }],
  };
}

const sun: SunExposure = {
  id: 'sun-1', date: '2026-07-10', heure: '13:30', dureeMin: 20,
  ciel: 'ensoleille', peau: 'visage-bras', phenotype: 'bronze', creme: 'visage', createdAt: 1,
};

async function run(name: string, args: unknown): Promise<any> {
  const tool = findTool(name)!;
  const parsed = tool.schema.safeParse(args);
  expect(parsed.success).toBe(true);
  if (!parsed.success) throw parsed.error;
  return tool.run(parsed.data);
}

beforeEach(() => {
  useStore.setState({ entries: [], customFoods: [], sunExposures: [], mutedDays: {}, dayNotes: {} });
});

describe('outils de lecture de l’agent', () => {
  it('déclare explicitement chaque lecture pour que la boucle reste fail-closed', () => {
    expect(READ_TOOLS.length).toBeGreaterThan(9);
    expect(READ_TOOLS.every((tool) => tool.policy === 'read')).toBe(true);
  });

  it('renvoie chaque facteur du calcul solaire avec sa date et son explication', async () => {
    useStore.setState({ sunExposures: [sun] });
    const result = await run('lire_soleil', { debut: '2026-07-01', fin: '2026-07-31', detail: 'complet' });
    expect(result.exposures).toHaveLength(1);
    expect(result.exposures[0].exposure.date).toBe('2026-07-10');
    expect(result.exposures[0].calculation.factors.map((f: any) => f.key)).toEqual([
      'duree', 'saison', 'heure', 'ciel', 'peau', 'phenotype', 'creme',
    ]);
    expect(result.exposures[0].calculation.factors.every((f: any) => f.detail && Number.isFinite(f.value))).toBe(true);
    expect(result.totalsByDate['2026-07-10'].cappedMicrograms).toBeGreaterThan(0);
  });

  it('calcule une moyenne sur les jours comptés et expose aussi le détail quotidien', async () => {
    useStore.setState({
      entries: [entry('2026-07-01', 50), entry('2026-07-02', 100), entry('2026-07-03', 1000)],
      mutedDays: { '2026-07-03': true },
    });
    const result = await run('moyenne_nutriments', {
      debut: '2026-07-01', fin: '2026-07-03', nutriments: ['proteines'], inclureSoleil: false,
      detail: 'quotidien',
    });
    expect(result.recordedDays).toBe(2);
    expect(result.dates).toEqual(['2026-07-01', '2026-07-02']);
    expect(result.averages[0].value).toBe(75);
    expect(result.daily).toHaveLength(2);
  });

  it('calcule la couverture par rapport à la cible optimale, pas à l’AJR', async () => {
    useStore.setState({ entries: [entry('2026-07-01', 75)] });
    const result = await run('moyenne_nutriments', {
      debut: '2026-07-01', fin: '2026-07-01', nutriments: ['proteines'], inclureSoleil: false,
    });
    const row = result.averages[0];
    expect(row.target.optimal).not.toBe(row.target.ajr);
    expect(row.coveragePercent).toBe(Math.round((row.value / row.target.optimal) * 1000) / 10);
  });

  it('rejette une période inversée avant toute lecture du store', () => {
    const parsed = findTool('lire_poids')!.schema.safeParse({ debut: '2026-08-01', fin: '2026-07-01' });
    expect(parsed.success).toBe(false);
  });

  it('classe les contributions d’un nutriment avec leur détail par date', async () => {
    useStore.setState({ entries: [entry('2026-07-01', 40), entry('2026-07-02', 60)] });
    const result = await run('contributions_nutriment', {
      debut: '2026-07-01', fin: '2026-07-02', nutriment: 'proteines', limite: 5,
    });
    expect(result.nutrient).toMatchObject({ key: 'proteines', unit: 'g' });
    expect(result.contributions[0]).toMatchObject({ nom: 'aliment test', total: 100, jours: 2 });
    expect(result.contributions[0].parDate).toEqual({ '2026-07-01': 40, '2026-07-02': 60 });
  });

  it('expose le profil et les objectifs actifs avec leur origine', async () => {
    const result = await run('lire_profil_objectifs', {});
    expect(result.profile).toBeDefined();
    expect(result.weightConfig).toBeDefined();
    expect(result.targets.length).toBeGreaterThan(10);
    expect(result.targets[0]).toHaveProperty('key');
    expect(result).toHaveProperty('customTargetOverrides');
  });

  it('réduit le résultat aux nutriments et au niveau de détail demandés', async () => {
    useStore.setState({ entries: [entry('2026-07-01', 50)] });
    const compact = await run('lire_repas', { date: '2026-07-01', detail: 'aliments' });
    expect(compact.days[0].meals[0].entries[0].items[0]).not.toHaveProperty('nutrients');
    const precise = await run('lire_repas', { date: '2026-07-01', detail: 'complet', nutriments: ['proteines'] });
    expect(precise.days[0].meals[0].entries[0].items[0].nutrients).toHaveLength(1);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(precise).length);
    const average = await run('moyenne_nutriments', { debut: '2026-07-01', fin: '2026-07-01', nutriments: ['proteines'] });
    expect(average).not.toHaveProperty('daily');
  });

  it('mesure la qualité des données et compare deux périodes sans calcul du modèle', async () => {
    useStore.setState({
      entries: [entry('2026-07-01', 50), entry('2026-07-03', 100)],
      mutedDays: { '2026-07-02': false },
    });
    const quality = await run('lire_qualite_donnees', { debut: '2026-07-01', fin: '2026-07-03' });
    expect(quality).toMatchObject({ totalDays: 3, filledDays: 2, forcedFastingDays: ['2026-07-02'] });
    const comparison = await run('comparer_periodes', {
      periodeA: { debut: '2026-07-01', fin: '2026-07-01' },
      periodeB: { debut: '2026-07-03', fin: '2026-07-03' },
      nutriments: ['proteines'], inclurePoids: false,
    });
    expect(comparison.nutrients[0]).toMatchObject({ key: 'proteines', valueA: 50, valueB: 100, delta: 50, deltaPercent: 100 });
  });

  it('retrouve l’identifiant d’une fiche avant une édition globale', async () => {
    useStore.setState({ customFoods: [{ id: 'food-lentilles', nom: 'Lentilles cuites', aliases: ['lentille'], categorie: 'feculent', n: { ...EMPTY_NUTRIENTS, proteines: 9 }, custom: true, origine: 'manuel' }] });
    const result = await run('rechercher_aliments_banque', { requete: 'lentille', limite: 5 });
    expect(result.foods[0]).toMatchObject({ id: 'food-lentilles', name: 'Lentilles cuites' });
  });

  it('filtre la banque personnelle par catégorie et ne renvoie que les nutriments demandés', async () => {
    useStore.setState({ customFoods: [
      { id: 'raisin', nom: 'Raisin', aliases: ['raisins'], categorie: 'fruit', n: { ...EMPTY_NUTRIENTS, vitC: 3, vitB9: 2, potassium: 191 }, origine: 'catalogue' },
      { id: 'pomme', nom: 'Pomme', aliases: [], categorie: 'fruit', n: { ...EMPTY_NUTRIENTS, vitC: 4.6, vitB9: 3 }, origine: 'catalogue' },
      { id: 'carotte', nom: 'Carotte', aliases: [], categorie: 'legume', n: { ...EMPTY_NUTRIENTS, vitC: 5.9 }, origine: 'catalogue' },
    ] });
    const result = await run('lire_aliments_banque', { categories: ['fruit'], nutriments: ['vitC', 'vitB9'], detail: 'nutriments' });
    expect(result).toMatchObject({ scope: 'banque-personnelle', total: 2, returned: 2, hasMore: false });
    expect(result.foods.map((food: any) => food.name)).toEqual(['Pomme', 'Raisin']);
    expect(result.foods[1].nutrients).toEqual([
      expect.objectContaining({ key: 'vitC', value: 3, unit: 'mg' }),
      expect.objectContaining({ key: 'vitB9', value: 2, unit: 'µg' }),
    ]);
    expect(result.foods[1].nutrients).toHaveLength(2);
  });

  it('peut lister toute la banque avec pagination et toutes les valeurs', async () => {
    useStore.setState({ customFoods: [
      { id: 'a', nom: 'Abricot', aliases: [], categorie: 'fruit', n: { ...EMPTY_NUTRIENTS, vitA: 96 }, origine: 'catalogue' },
      { id: 'b', nom: 'Banane', aliases: [], categorie: 'fruit', n: { ...EMPTY_NUTRIENTS, vitB6: 0.37 }, origine: 'catalogue' },
    ] });
    const result = await run('lire_aliments_banque', { offset: 0, limite: 1, detail: 'complet' });
    expect(result).toMatchObject({ total: 2, returned: 1, hasMore: true });
    expect(result.foods[0].nutrients).toHaveLength(Object.keys(EMPTY_NUTRIENTS).length);
    expect(result.foods[0]).toHaveProperty('pieceGrams');
  });
});
