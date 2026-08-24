import { describe, expect, it } from 'vitest';
import { addDays, heatLevel, heatmapColumns, monthSpans, streaks, windowStart } from '../src/ui/HistoryHeatmap';

describe('addDays', () => {
  it('avance et recule sur les bascules de mois et d’année', () => {
    expect(addDays('2026-08-23', 1)).toBe('2026-08-24');
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // année bissextile
  });

  it('traverse un changement d’heure sans perdre ni gagner un jour', () => {
    // Passage à l'heure d'été en France : nuit du 28 au 29 mars 2026.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
  });
});

describe('windowStart', () => {
  it('remonte de N-1 jours quand l’historique est plus ancien', () => {
    expect(windowStart('2026-08-23', 91, '2020-01-01')).toBe('2026-05-25');
  });

  it('ne remonte jamais avant le premier jour enregistré', () => {
    expect(windowStart('2026-08-23', 365, '2026-06-20')).toBe('2026-06-20');
  });

  it('sans historique, garde la fenêtre demandée', () => {
    expect(windowStart('2026-08-23', 7, null)).toBe('2026-08-17');
  });
});

describe('heatmapColumns', () => {
  it('aligne la première colonne sur le lundi et comble avant le début', () => {
    // 2026-08-23 est un dimanche : la colonne commence le lundi 17.
    const cols = heatmapColumns('2026-08-23', '2026-08-25');
    expect(cols).toHaveLength(2);
    expect(cols[0]).toEqual([null, null, null, null, null, null, '2026-08-23']);
    expect(cols[1].slice(0, 3)).toEqual(['2026-08-24', '2026-08-25', null]);
  });

  it('couvre exactement la fenêtre, sans doublon ni trou', () => {
    const cols = heatmapColumns('2026-01-01', '2026-12-31');
    const dates = cols.flat().filter((d): d is string => d !== null);
    expect(dates).toHaveLength(365);
    expect(new Set(dates).size).toBe(365);
    expect(dates[0]).toBe('2026-01-01');
    expect(dates[364]).toBe('2026-12-31');
    for (const col of cols) expect(col).toHaveLength(7);
  });

  it('rend une grille vide si la fin précède le début', () => {
    expect(heatmapColumns('2026-08-23', '2026-08-01')).toEqual([]);
  });
});

describe('monthSpans', () => {
  it('regroupe les colonnes consécutives d’un même mois', () => {
    const spans = monthSpans(heatmapColumns('2026-01-01', '2026-03-31'));
    expect(spans.map((s) => s.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    // 13 colonnes couvrant le trimestre, chacune comptée une seule fois.
    expect(spans.reduce((a, s) => a + s.span, 0)).toBe(heatmapColumns('2026-01-01', '2026-03-31').length);
  });

  it('marque l’année sur janvier seulement', () => {
    const spans = monthSpans(heatmapColumns('2025-12-01', '2026-01-31'));
    expect(spans[0].label).not.toMatch(/\d/);
    expect(spans[1].label).toMatch(/26$/);
  });
});

describe('heatLevel', () => {
  it('reprend les seuils du calendrier mensuel', () => {
    expect(heatLevel(0.69).level).toBe('under');
    expect(heatLevel(0.7).level).toBe('ok');
    expect(heatLevel(1.1).level).toBe('ok');
    expect(heatLevel(1.11).level).toBe('over');
  });

  it('monte en intensité avec l’écart', () => {
    expect(heatLevel(0.6).step).toBe(1);
    expect(heatLevel(0.5).step).toBe(2);
    expect(heatLevel(0.2).step).toBe(3);
    expect(heatLevel(1.2).step).toBe(1);
    expect(heatLevel(1.4).step).toBe(2);
    expect(heatLevel(2)).toEqual({ level: 'over', step: 3 });
  });
});

describe('streaks', () => {
  it('compte la meilleure série et celle en cours', () => {
    expect(streaks([true, true, false, true, true, true])).toEqual({ courante: 3, meilleure: 3 });
  });

  it('ne casse pas la série sur la journée en cours pas encore remplie', () => {
    expect(streaks([true, true, true, false])).toEqual({ courante: 3, meilleure: 3 });
  });

  it('retombe à zéro après deux jours vides', () => {
    expect(streaks([true, true, false, false])).toEqual({ courante: 0, meilleure: 2 });
  });

  it('gère la fenêtre vide', () => {
    expect(streaks([])).toEqual({ courante: 0, meilleure: 0 });
  });
});
