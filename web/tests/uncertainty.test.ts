import { describe, expect, it } from 'vitest';
import { dayKcalUncertainty, itemKcalUncertainty, isPhotoEntry } from '../src/nutrition/uncertainty';
import type { UncertainItem } from '../src/nutrition/uncertainty';
import { validateExtraction } from '../src/extraction/schema';

/** Item de base : 100 g pesés d'un aliment de la base, 300 kcal. */
function item(patch: Partial<UncertainItem> = {}): UncertainItem {
  return {
    nomAffiche: 'test',
    quantite: 100,
    unite: 'g',
    estimation: false,
    douteux: false,
    nutrients: { kcal: 300 },
    ...patch,
  };
}

describe('incertitude par item', () => {
  it('reste faible pour des grammes pesés d\'un aliment de la base', () => {
    const pm = itemKcalUncertainty(item());
    // ≈ hypot(0.05, 0.08) × 300 ≈ 28 kcal
    expect(pm).toBeGreaterThan(20);
    expect(pm).toBeLessThan(40);
  });

  it('augmente avec les unités floues (bol > pièce > grammes)', () => {
    const grammes = itemKcalUncertainty(item());
    const piece = itemKcalUncertainty(item({ unite: 'piece', quantite: 1 }));
    const bol = itemKcalUncertainty(item({ unite: 'bol', quantite: 1 }));
    expect(piece).toBeGreaterThan(grammes);
    expect(bol).toBeGreaterThan(piece);
  });

  it('augmente quand la quantité a été devinée par l\'IA (estimation)', () => {
    expect(itemKcalUncertainty(item({ estimation: true }))).toBeGreaterThan(itemKcalUncertainty(item()));
  });

  it('augmente encore pour une photo', () => {
    const estime = itemKcalUncertainty(item({ estimation: true }));
    const photo = itemKcalUncertainty(item({ estimation: true }), true);
    expect(photo).toBeGreaterThan(estime);
  });

  it('augmente pour des nutriments estimés par l\'IA ou un matching douteux', () => {
    const base = itemKcalUncertainty(item());
    expect(itemKcalUncertainty(item({ iaEstime: {} }))).toBeGreaterThan(base);
    expect(itemKcalUncertainty(item({ douteux: true }))).toBeGreaterThan(base);
  });

  it('la fourchette explicite de l\'IA remplace le forfait', () => {
    // Fourchette étroite sur un bol (forfait ±30 %) → moins incertain que le forfait.
    const forfait = itemKcalUncertainty(item({ unite: 'bol', quantite: 1, estimation: true }));
    const etroite = itemKcalUncertainty(
      item({ unite: 'bol', quantite: 1, estimation: true, quantiteMin: 0.9, quantiteMax: 1.1 }),
    );
    expect(etroite).toBeLessThan(forfait);
    // Fourchette large sur des grammes (forfait ±5 %) → plus incertain que le forfait.
    const large = itemKcalUncertainty(item({ quantite: 180, quantiteMin: 120, quantiteMax: 250, estimation: true }));
    expect(large).toBeGreaterThan(itemKcalUncertainty(item({ quantite: 180 })));
  });

  it('un item sans kcal ne contribue pas', () => {
    expect(itemKcalUncertainty(item({ nutrients: { kcal: 0 } }))).toBe(0);
  });
});

describe('incertitude du jour', () => {
  it('agrège en somme quadratique (pas linéaire)', () => {
    const entries = [
      { transcript: 'repas 1', items: [item()] },
      { transcript: 'repas 2', items: [item(), item()] },
    ];
    const pmItem = itemKcalUncertainty(item());
    const { pm } = dayKcalUncertainty(entries);
    expect(pm).toBeCloseTo(Math.sqrt(3 * pmItem * pmItem), 6);
    expect(pm).toBeLessThan(3 * pmItem);
  });

  it('détecte les entrées photo et liste les items les plus incertains', () => {
    expect(isPhotoEntry({ transcript: '📷 Photo' })).toBe(true);
    expect(isPhotoEntry({ transcript: 'un bol de riz' })).toBe(false);
    const entries = [
      { transcript: '📷 Photo', items: [item({ nomAffiche: 'photo-item', estimation: true })] },
      { transcript: 'pesé', items: [item({ nomAffiche: 'pesé-item' })] },
    ];
    const { top } = dayKcalUncertainty(entries);
    expect(top[0].nom).toBe('photo-item');
    expect(top[0].pm).toBeCloseTo(itemKcalUncertainty(item({ estimation: true }), true), 6);
  });

  it('fonctionne sur l\'historique existant (items sans fourchette)', () => {
    const { pm, top } = dayKcalUncertainty([{ transcript: 'ancien repas', items: [item()] }]);
    expect(pm).toBeGreaterThan(0);
    expect(top).toHaveLength(1);
  });
});

describe('validation de la fourchette extraite', () => {
  const base = { aliment: 'riz', quantite: 180, unite: 'g', estimation: true };

  it('conserve une fourchette cohérente', () => {
    const items = validateExtraction({ items: [{ ...base, quantiteMin: 120, quantiteMax: 250 }] })!;
    expect(items[0].quantiteMin).toBe(120);
    expect(items[0].quantiteMax).toBe(250);
  });

  it('rejette une fourchette incohérente (min ≥ max ou quantité hors fourchette)', () => {
    const inversee = validateExtraction({ items: [{ ...base, quantiteMin: 250, quantiteMax: 120 }] })!;
    expect(inversee[0].quantiteMin).toBeUndefined();
    const hors = validateExtraction({ items: [{ ...base, quantiteMin: 200, quantiteMax: 250 }] })!;
    expect(hors[0].quantiteMin).toBeUndefined();
  });
});
