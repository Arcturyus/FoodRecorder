import { describe, expect, it } from 'vitest';
import {
  foodFrequencies,
  frequencyKey,
  occurrencesByDate,
  nutrientContributions,
} from '../src/nutrition/frequency';
import type { JournalEntry, JournalItem } from '../src/store/store';
import { EMPTY_NUTRIENTS } from '../src/nutrition/types';
import type { Nutrients } from '../src/nutrition/types';

function item(foodId: string | null, nom: string, kcal = 100, grams = 100): JournalItem {
  return {
    id: `i-${nom}-${Math.random()}`,
    foodId,
    nomAffiche: nom,
    quantite: 1,
    unite: 'piece',
    grams,
    nutrients: { ...EMPTY_NUTRIENTS, kcal },
    estimation: false,
    douteux: false,
  };
}

function entry(date: string, items: JournalItem[], createdAt = 0): JournalEntry {
  return { id: `e-${date}-${createdAt}`, date, createdAt, transcript: '', source: 'manuel', items };
}

const ALL = { start: '2026-01-01', end: '2026-12-31' };

describe('foodFrequencies', () => {
  it('agrège occurrences, jours distincts, grammes et kcal par aliment', () => {
    const entries = [
      entry('2026-03-01', [item('saumon', 'Saumon (cuit)', 200, 130), item('riz-blanc', 'Riz blanc (cuit)')]),
      // Deux fois du saumon le MÊME jour : 2 occurrences mais 1 seul jour.
      entry('2026-03-05', [item('saumon', 'Saumon (cuit)', 200, 130), item('saumon', 'Saumon (cuit)', 200, 70)], 1),
    ];

    const [saumon, riz] = foodFrequencies(entries, ALL);

    expect(saumon.foodId).toBe('saumon');
    expect(saumon.occurrences).toBe(3);
    expect(saumon.jours).toBe(2);
    expect(saumon.grammes).toBe(330);
    expect(saumon.kcal).toBe(600);
    expect(saumon.dates).toEqual(['2026-03-01', '2026-03-05']);
    expect(saumon.derniere).toBe('2026-03-05');

    // Tri par occurrences décroissantes.
    expect(riz.foodId).toBe('riz-blanc');
    expect(riz.occurrences).toBe(1);
  });

  it('renseigne la catégorie : banque pour les résolus, item pour les estimés', () => {
    const brick = { ...item(null, 'brick au thon'), categorie: 'poisson' as const };
    const entries = [entry('2026-03-01', [item('saumon', 'Saumon (cuit)'), brick, item(null, 'sauce mystère')])];

    const freqs = foodFrequencies(entries, ALL, (id) => (id === 'saumon' ? 'poisson' : undefined));
    const byNom = new Map(freqs.map((f) => [f.nom, f]));

    expect(byNom.get('Saumon (cuit)')!.categorie).toBe('poisson');
    expect(byNom.get('brick au thon')!.categorie).toBe('poisson');
    // Aliment jamais classé : c'est lui que le rattrapage IA doit rattraper.
    expect(byNom.get('sauce mystère')!.categorie).toBeNull();
  });

  it('ne retient que les entrées de la plage demandée', () => {
    const entries = [
      entry('2026-03-01', [item('banane', 'Banane')]),
      entry('2026-06-01', [item('banane', 'Banane')]),
    ];
    const freqs = foodFrequencies(entries, { start: '2026-05-01', end: '2026-07-01' });
    expect(freqs).toHaveLength(1);
    expect(freqs[0].occurrences).toBe(1);
    expect(freqs[0].dates).toEqual(['2026-06-01']);
  });

  it('regroupe les aliments non résolus sur leur nom normalisé', () => {
    const entries = [
      entry('2026-03-01', [item(null, 'Tarte aux myrtilles')]),
      entry('2026-03-02', [item(null, 'tarte aux myrtille')], 1),
    ];
    const freqs = foodFrequencies(entries, ALL);
    expect(freqs).toHaveLength(1);
    expect(freqs[0].foodId).toBeNull();
    expect(freqs[0].occurrences).toBe(2);
    // Libellé retenu = celui de la consommation la plus récente.
    expect(freqs[0].nom).toBe('tarte aux myrtille');
  });

  it('ne confond pas deux aliments distincts de même libellé mais d’ids différents', () => {
    const entries = [
      entry('2026-03-01', [item('fromage-blanc-0', 'Fromage blanc'), item('fromage-blanc', 'Fromage blanc')]),
    ];
    expect(foodFrequencies(entries, ALL)).toHaveLength(2);
  });

  it('frequencyKey préfère le foodId et normalise les noms libres', () => {
    expect(frequencyKey('saumon', 'Saumon (cuit)')).toBe('saumon');
    expect(frequencyKey(null, 'Tartes aux Myrtilles')).toBe(frequencyKey(null, 'tarte aux myrtille'));
  });
});

describe('nutrientContributions', () => {
  function nItem(foodId: string | null, nom: string, n: Partial<Nutrients>, grams = 100): JournalItem {
    return { ...item(foodId, nom, 0, grams), nutrients: { ...EMPTY_NUTRIENTS, ...n } };
  }

  it('classe les aliments par quantité apportée du nutriment choisi', () => {
    const entries = [
      entry('2026-03-01', [nItem('epinards', 'Épinards', { fer: 3 }), nItem('steak', 'Steak haché', { fer: 2.5 })]),
      entry('2026-03-03', [nItem('epinards', 'Épinards', { fer: 4 })], 1),
    ];

    const [epinards, steak] = nutrientContributions(entries, ALL, 'fer');

    expect(epinards.foodId).toBe('epinards');
    expect(epinards.total).toBe(7);
    expect(epinards.occurrences).toBe(2);
    expect(epinards.jours).toBe(2);
    expect(epinards.grammes).toBe(200);
    expect(epinards.derniere).toBe('2026-03-03');
    expect([...epinards.parDate.entries()]).toEqual([['2026-03-01', 3], ['2026-03-03', 4]]);
    expect(steak.total).toBe(2.5);
  });

  it('cumule les apports du même aliment dans une même journée', () => {
    const entries = [
      entry('2026-03-01', [nItem('saumon', 'Saumon', { omega3Dha: 1 }), nItem('saumon', 'Saumon', { omega3Dha: 0.5 })]),
    ];
    const [saumon] = nutrientContributions(entries, ALL, 'omega3Dha');
    expect(saumon.total).toBe(1.5);
    expect(saumon.occurrences).toBe(2);
    expect(saumon.jours).toBe(1);
    expect(saumon.parDate.get('2026-03-01')).toBe(1.5);
  });

  it('écarte les aliments sans apport du nutriment et respecte la plage', () => {
    const entries = [
      entry('2026-03-01', [nItem('riz', 'Riz', { fer: 0 }), nItem('lentilles', 'Lentilles', { fer: 3 })]),
      entry('2026-06-01', [nItem('lentilles', 'Lentilles', { fer: 9 })], 1),
    ];
    const contribs = nutrientContributions(entries, { start: '2026-01-01', end: '2026-03-31' }, 'fer');
    expect(contribs).toHaveLength(1);
    expect(contribs[0].nom).toBe('Lentilles');
    expect(contribs[0].total).toBe(3);
  });

  it('regroupe les aliments libres sur leur nom normalisé, libellé le plus récent retenu', () => {
    const entries = [
      entry('2026-03-01', [nItem(null, 'Tarte aux myrtilles', { vitC: 4 })]),
      entry('2026-03-02', [nItem(null, 'tarte aux myrtille', { vitC: 6 })], 1),
    ];
    const contribs = nutrientContributions(entries, ALL, 'vitC');
    expect(contribs).toHaveLength(1);
    expect(contribs[0].nom).toBe('tarte aux myrtille');
    expect(contribs[0].total).toBe(10);
  });
});

describe('occurrencesByDate', () => {
  it('compte les occurrences par jour pour un seul aliment', () => {
    const entries = [
      entry('2026-03-01', [item('saumon', 'Saumon (cuit)'), item('riz-blanc', 'Riz blanc (cuit)')]),
      entry('2026-03-01', [item('saumon', 'Saumon (cuit)')], 1),
      entry('2026-03-04', [item('saumon', 'Saumon (cuit)')], 2),
    ];
    const [saumon] = foodFrequencies(entries, ALL);
    const counts = occurrencesByDate(saumon, entries);
    expect(counts.get('2026-03-01')).toBe(2);
    expect(counts.get('2026-03-04')).toBe(1);
    expect(counts.size).toBe(2);
  });
});
