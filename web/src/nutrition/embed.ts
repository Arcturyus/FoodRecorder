import type { NutrientKey } from './types';
import { pca2 } from './pca';

/**
 * Projections 2D non linéaires de la table « aliments × nutriments », en TypeScript
 * pur (sans dépendance), pour proposer dans la carte des alternatives à l'ACP :
 *  - `tsne`  : t-SNE — préserve les VOISINAGES → fait ressortir les grappes (familles).
 *              Distances entre grappes et tailles non significatives, résultat stochastique.
 *  - `mds`   : MDS métrique (SMACOF) — préserve au mieux les DISTANCES par paires.
 *
 * Chaque colonne est standardisée (z-score) puis pondérée par √importance, comme
 * l'ACP (`pca2`), pour comparer les trois cartes à armes égales. n étant petit
 * (~150 aliments), les algorithmes O(n²) suffisent largement.
 */

export interface EmbedInput {
  /** Identifiants des lignes (aliments). */
  ids: string[];
  /** Valeurs n×m déjà normalisées par l'appelant (/100 kcal, /100 g…). */
  matrix: number[][];
  /** Poids d'importance par nutriment (longueur m). Défaut : 1 partout. */
  weights?: number[];
}

export interface EmbedResult {
  scores: { id: string; x: number; y: number }[];
}

/** PRNG déterministe (mulberry32) : mêmes coordonnées à chaque rendu, pas de scintillement. */
function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standardisation z-score par colonne, pondérée par √poids (identique à `pca2`). */
function buildX(matrix: number[][], weights?: number[]): number[][] {
  const n = matrix.length;
  if (n === 0) return [];
  const m = matrix[0].length;
  const w = weights ?? new Array(m).fill(1);
  const X = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += matrix[i][j] ?? 0;
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const d = (matrix[i][j] ?? 0) - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / n);
    const ww = Math.sqrt(Math.max(0, w[j]));
    for (let i = 0; i < n; i++) X[i][j] = std > 1e-9 ? (((matrix[i][j] ?? 0) - mean) / std) * ww : 0;
  }
  return X;
}

/** Matrice n×n des distances euclidiennes au carré. */
function pairwiseSq(X: number[][]): number[][] {
  const n = X.length;
  const D = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let s = 0;
      const a = X[i];
      const b = X[j];
      for (let k = 0; k < a.length; k++) {
        const d = a[k] - b[k];
        s += d * d;
      }
      D[i][j] = s;
      D[j][i] = s;
    }
  }
  return D;
}

// ---------------------------------------------------------------------------
// MDS métrique (SMACOF) — préserve les distances euclidiennes
// ---------------------------------------------------------------------------

export function mds(input: EmbedInput, iterations = 120): EmbedResult {
  const X = buildX(input.matrix, input.weights);
  const n = X.length;
  if (n === 0) return { scores: [] };
  if (n < 3) return { scores: input.ids.map((id, i) => ({ id, x: i, y: 0 })) };

  const Dsq = pairwiseSq(X);
  const delta = Dsq.map((row) => row.map((v) => Math.sqrt(v))); // dissimilarités cibles

  // Init par l'ACP (déterministe, déjà proche de l'optimum) puis raffinement SMACOF.
  const p = pca2({
    ids: input.ids,
    keys: X[0].map((_, j) => String(j) as NutrientKey),
    matrix: input.matrix,
    weights: input.weights,
  });
  let Y = p.scores.map((s) => [s.x, s.y]);

  for (let it = 0; it < iterations; it++) {
    const Ynew = Array.from({ length: n }, () => [0, 0]);
    for (let i = 0; i < n; i++) {
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const dx = Y[i][0] - Y[j][0];
        const dy = Y[i][1] - Y[j][1];
        const dij = Math.hypot(dx, dy);
        // Transformée de Guttman : Y⁺_i = (1/n) Σ_j (δ_ij / d_ij)(Y_i − Y_j).
        const ratio = dij > 1e-9 ? delta[i][j] / dij : 0;
        sx += ratio * dx;
        sy += ratio * dy;
      }
      Ynew[i][0] = sx / n;
      Ynew[i][1] = sy / n;
    }
    Y = Ynew;
  }

  return { scores: input.ids.map((id, i) => ({ id, x: Y[i][0], y: Y[i][1] })) };
}

// ---------------------------------------------------------------------------
// t-SNE — préserve les voisinages (grappes)
// ---------------------------------------------------------------------------

/** Affinités hautes dimensions P_{j|i} avec recherche de β pour atteindre la perplexité. */
function highDimAffinities(Dsq: number[][], perplexity: number): number[][] {
  const n = Dsq.length;
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  const logU = Math.log(perplexity);

  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1;
    const row = new Array(n).fill(0);

    for (let iter = 0; iter < 60; iter++) {
      let sumP = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        row[j] = Math.exp(-Dsq[i][j] * beta);
        sumP += row[j];
      }
      if (sumP < 1e-12) sumP = 1e-12;
      // Entropie de Shannon de la distribution i.
      let H = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        H += beta * Dsq[i][j] * row[j];
      }
      H = H / sumP + Math.log(sumP);

      const diff = H - logU;
      if (Math.abs(diff) < 1e-5) {
        for (let j = 0; j < n; j++) P[i][j] = j === i ? 0 : row[j] / sumP;
        break;
      }
      if (diff > 0) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
      if (iter === 59) for (let j = 0; j < n; j++) P[i][j] = j === i ? 0 : row[j] / sumP;
    }
  }
  return P;
}

export function tsne(
  input: EmbedInput,
  // eta ~20 : au-delà de ~50, ce gradient (P,Q normalisés à somme 1) diverge ; en deçà, sous-converge.
  { perplexity = 30, iterations = 800, seed = 42, eta = 20, exag = 4 }:
    { perplexity?: number; iterations?: number; seed?: number; eta?: number; exag?: number } = {},
): EmbedResult {
  const X = buildX(input.matrix, input.weights);
  const n = X.length;
  if (n === 0) return { scores: [] };
  if (n < 5) return { scores: input.ids.map((id, i) => ({ id, x: i, y: 0 })) };

  const perp = Math.max(2, Math.min(perplexity, Math.floor((n - 1) / 3)));
  const Dsq = pairwiseSq(X);

  // P symétrique conjoint : (P_{j|i} + P_{i|j}) / (2n), plancher pour éviter log(0).
  const Pcond = highDimAffinities(Dsq, perp);
  const P = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = (Pcond[i][j] + Pcond[j][i]) / (2 * n);
      P[i][j] = Math.max(v, 1e-12);
    }
  }

  const rand = mulberry32(seed);
  const Y = Array.from({ length: n }, () => [(rand() - 0.5) * 1e-4, (rand() - 0.5) * 1e-4]);
  const gains = Array.from({ length: n }, () => [1, 1]);
  const inc = Array.from({ length: n }, () => [0, 0]);

  const EXAG = exag;
  const STOP_EXAG = 100;

  for (let iter = 0; iter < iterations; iter++) {
    const momentum = iter < 250 ? 0.5 : 0.8;
    const exag = iter < STOP_EXAG ? EXAG : 1;

    // Q (loi de Student) : num_ij = 1 / (1 + ||y_i − y_j||²).
    const num = Array.from({ length: n }, () => new Array(n).fill(0));
    let sumNum = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i][0] - Y[j][0];
        const dy = Y[i][1] - Y[j][1];
        const q = 1 / (1 + dx * dx + dy * dy);
        num[i][j] = q;
        num[j][i] = q;
        sumNum += 2 * q;
      }
    }
    if (sumNum < 1e-12) sumNum = 1e-12;

    // Gradient : 4 Σ_j (P_ij·exag − Q_ij) · num_ij · (y_i − y_j).
    for (let i = 0; i < n; i++) {
      let gx = 0;
      let gy = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const q = num[i][j] / sumNum;
        const mult = (P[i][j] * exag - q) * num[i][j];
        gx += mult * (Y[i][0] - Y[j][0]);
        gy += mult * (Y[i][1] - Y[j][1]);
      }
      gx *= 4;
      gy *= 4;

      // Adaptive gains + momentum (recette « Jacobs » de van der Maaten).
      gains[i][0] = Math.max(0.01, Math.sign(gx) !== Math.sign(inc[i][0]) ? gains[i][0] + 0.2 : gains[i][0] * 0.8);
      gains[i][1] = Math.max(0.01, Math.sign(gy) !== Math.sign(inc[i][1]) ? gains[i][1] + 0.2 : gains[i][1] * 0.8);
      inc[i][0] = momentum * inc[i][0] - eta * gains[i][0] * gx;
      inc[i][1] = momentum * inc[i][1] - eta * gains[i][1] * gy;
      Y[i][0] += inc[i][0];
      Y[i][1] += inc[i][1];
    }

    // Recentrage (évite la dérive globale).
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
      mx += Y[i][0];
      my += Y[i][1];
    }
    mx /= n;
    my /= n;
    for (let i = 0; i < n; i++) {
      Y[i][0] -= mx;
      Y[i][1] -= my;
    }
  }

  return { scores: input.ids.map((id, i) => ({ id, x: Y[i][0], y: Y[i][1] })) };
}
