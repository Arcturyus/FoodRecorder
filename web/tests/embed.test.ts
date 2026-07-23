import { describe, it, expect } from 'vitest';
import { tsne, mds } from '../src/nutrition/embed';

/** Deux grappes bien séparées dans un espace 4D, dupliquées pour avoir assez de points. */
function twoClusters(n = 40) {
  const ids: string[] = [];
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = i < n / 2;
    ids.push((a ? 'A' : 'B') + i);
    // Grappe A autour de (0,0,10,10), grappe B autour de (10,10,0,0), + bruit déterministe.
    const jit = ((i * 37) % 5) * 0.1;
    matrix.push(a ? [jit, jit, 10 + jit, 10 - jit] : [10 - jit, 10 + jit, jit, jit]);
  }
  return { ids, matrix };
}

const finite = (scores: { x: number; y: number }[]) =>
  scores.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y));

describe('mds', () => {
  it('renvoie une coordonnée finie par aliment', () => {
    const { ids, matrix } = twoClusters();
    const { scores } = mds({ ids, matrix });
    expect(scores).toHaveLength(ids.length);
    expect(finite(scores)).toBe(true);
  });

  it('sépare deux grappes (distance inter > intra)', () => {
    const { ids, matrix } = twoClusters();
    const { scores } = mds({ ids, matrix });
    const byId = new Map(scores.map((s) => [s.id, s]));
    const cen = (pref: string) => {
      const pts = scores.filter((s) => s.id.startsWith(pref));
      return [pts.reduce((a, p) => a + p.x, 0) / pts.length, pts.reduce((a, p) => a + p.y, 0) / pts.length];
    };
    const [ax, ay] = cen('A');
    const [bx, by] = cen('B');
    const inter = Math.hypot(ax - bx, ay - by);
    const intra =
      Math.hypot(byId.get('A0')!.x - ax, byId.get('A0')!.y - ay) +
      Math.hypot(byId.get('B20')!.x - bx, byId.get('B20')!.y - by);
    expect(inter).toBeGreaterThan(intra);
  });
});

describe('tsne', () => {
  it('renvoie des coordonnées finies et est déterministe (même graine)', () => {
    const { ids, matrix } = twoClusters();
    const r1 = tsne({ ids, matrix }, { iterations: 200 });
    const r2 = tsne({ ids, matrix }, { iterations: 200 });
    expect(r1.scores).toHaveLength(ids.length);
    expect(finite(r1.scores)).toBe(true);
    expect(r2.scores[0]).toEqual(r1.scores[0]);
  });

  it('ne diverge pas (coordonnées bornées) avec eta par défaut', () => {
    const { ids, matrix } = twoClusters();
    const { scores } = tsne({ ids, matrix }, { iterations: 300 });
    const rmax = Math.max(...scores.map((s) => Math.hypot(s.x, s.y)));
    expect(rmax).toBeLessThan(1e6); // borné : pas d'explosion numérique (eta trop grand → ~1e21)
  });
});
