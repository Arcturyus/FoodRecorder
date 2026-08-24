import { describe, expect, it } from 'vitest';
import { placeParetoLabels } from '../src/ui/FoodExplorer';
import type { LabelFrame } from '../src/ui/FoodExplorer';

/** Cadre du nuage réel : viewBox 680 × 420, marges d'axes comprises. */
const FRAME: LabelFrame = { left: 44, right: 640, top: 16, bottom: 380 };

describe('placeParetoLabels', () => {
  it('nomme des points bien espacés en haut-droite', () => {
    const out = placeParetoLabels(
      [
        { text: 'Épinards', x: 100, y: 300, r: 5 },
        { text: 'Cabillaud', x: 300, y: 150, r: 5 },
      ],
      FRAME,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ text: 'Épinards', anchor: 'start' });
    // Haut-droite : décalée du rayon + 4 px.
    expect(out[0].x).toBe(109);
    expect(out[0].y).toBe(291);
  });

  it('replace la seconde étiquette plutôt que de la superposer', () => {
    const out = placeParetoLabels(
      [
        { text: 'Brocoli', x: 200, y: 200, r: 5 },
        { text: 'Chou', x: 202, y: 201, r: 5 },
      ],
      FRAME,
    );
    expect(out).toHaveLength(2);
    // Les deux boîtes ne peuvent pas être au même endroit.
    expect(out[1].y).not.toBe(out[0].y);
  });

  it('abandonne les étiquettes au-delà des quatre positions disponibles', () => {
    // Six aliments confondus (échelle log très resserrée) : quatre noms au plus
    // peuvent tenir autour du point, les autres sont abandonnés.
    const crowd = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((text) => ({
      text,
      x: 300,
      y: 200,
      r: 5,
    }));
    const out = placeParetoLabels(crowd, FRAME);
    expect(out).toHaveLength(4);
    expect(out.map((l) => l.text)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
    // Ce qui est posé reste sans chevauchement — c'est tout l'intérêt d'abandonner.
    expect(new Set(out.map((l) => `${l.x},${l.y}`)).size).toBe(out.length);
  });

  it('bascule à gauche plutôt que de déborder du bord droit', () => {
    const out = placeParetoLabels([{ text: 'Cabillaud', x: 636, y: 200, r: 5 }], FRAME);
    expect(out[0].anchor).toBe('end');
    expect(out[0].x).toBe(627);
  });

  it('ne pose rien quand le cadre est trop petit pour le nom', () => {
    const etroit: LabelFrame = { left: 0, right: 40, top: 0, bottom: 40 };
    const out = placeParetoLabels([{ text: 'Cabillaud', x: 20, y: 20, r: 5 }], etroit);
    expect(out).toHaveLength(0);
  });

  it('coupe les noms trop longs plutôt que de les laisser manger le graphe', () => {
    const out = placeParetoLabels(
      [{ text: 'Filet de cabillaud vapeur sans sel', x: 200, y: 200, r: 5 }],
      FRAME,
    );
    expect(out[0].text).toBe('Filet de cabillau…');
    expect(out[0].text.length).toBe(18);
  });
});
