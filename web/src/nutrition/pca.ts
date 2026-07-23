import type { NutrientKey } from './types';

/**
 * ACP (analyse en composantes principales) 2D maison, sans dépendance : projette
 * une table « aliments × nutriments » sur ses deux axes de plus grande variance,
 * pour un biplot (aliments = points, nutriments = flèches). Chaque colonne est
 * standardisée (z-score) puis pondérée : un poids permet de faire compter
 * davantage — ou plus du tout — un nutriment (réutilise les curseurs d'importance).
 *
 * La covariance est calculée sur les colonnes (m nutriments, petit), donc le coût
 * reste faible même avec beaucoup d'aliments. Les deux premiers vecteurs propres
 * sont obtenus par itération de puissance + déflation.
 */

export interface PcaInput {
  /** Identifiants des lignes (aliments), longueur n. */
  ids: string[];
  /** Nutriments (colonnes/features), longueur m. */
  keys: NutrientKey[];
  /** Valeurs brutes n×m (déjà normalisées par l'appelant : /100 kcal, /100 g, /portion). */
  matrix: number[][];
  /** Poids par nutriment (longueur m). Défaut : 1 partout. Un poids 0 neutralise le nutriment. */
  weights?: number[];
}

export interface PcaResult {
  /**
   * Projection des aliments sur (PC1, PC2). `cos2` = qualité de représentation en 2D
   * (part du profil captée par le plan = (x²+y²)/‖vecteur standardisé‖²), 0→1.
   */
  scores: { id: string; x: number; y: number; cos2: number }[];
  /** Projection des nutriments (flèches du biplot), longueur = axes actifs. */
  loadings: { key: NutrientKey; x: number; y: number }[];
  /** Fraction de variance expliquée par PC1 et PC2. */
  explained: [number, number];
}

/** Produit matrice (m×m) × vecteur (m). */
function matVec(C: number[][], v: number[]): number[] {
  const m = C.length;
  const out = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += C[i][j] * v[j];
    out[i] = s;
  }
  return out;
}

function norm(v: number[]): number {
  return Math.sqrt(v.reduce((a, x) => a + x * x, 0));
}

/** Vecteur propre dominant de C (symétrique) par itération de puissance + sa valeur propre. */
function dominantEigen(C: number[][], iters = 200): { vec: number[]; value: number } {
  const m = C.length;
  // Init déterministe et « variée » (évite l'orthogonalité accidentelle avec l'axe cherché).
  let v = Array.from({ length: m }, (_, j) => Math.sin(j + 1) + 0.1);
  let n = norm(v);
  v = v.map((x) => x / (n || 1));
  for (let it = 0; it < iters; it++) {
    const w = matVec(C, v);
    n = norm(w);
    if (n < 1e-12) break;
    v = w.map((x) => x / n);
  }
  const Cv = matVec(C, v);
  const value = v.reduce((a, x, i) => a + x * Cv[i], 0);
  return { vec: v, value };
}

/** Déflation : retire la composante (λ v vᵀ) de C pour révéler l'axe suivant. */
function deflate(C: number[][], vec: number[], value: number): number[][] {
  return C.map((row, i) => row.map((c, j) => c - value * vec[i] * vec[j]));
}

export function pca2(input: PcaInput): PcaResult {
  const { ids, keys, matrix } = input;
  const n = ids.length;
  const m = keys.length;
  const weights = input.weights ?? new Array(m).fill(1);

  // Colonnes vides (aucun aliment, aucun nutriment) : rien à projeter.
  if (n === 0 || m === 0) {
    return { scores: ids.map((id) => ({ id, x: 0, y: 0, cos2: 0 })), loadings: [], explained: [0, 0] };
  }

  // Standardisation z-score par colonne, puis pondération (√poids → la distance
  // pondérée euclidienne pèse chaque nutriment par `weight`). Une colonne constante
  // ou de poids nul devient nulle (n'influence ni les axes ni les distances).
  const X: number[][] = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let j = 0; j < m; j++) {
    const col = matrix.map((row) => row[j] ?? 0);
    const mean = col.reduce((a, x) => a + x, 0) / n;
    let variance = col.reduce((a, x) => a + (x - mean) * (x - mean), 0) / n;
    const std = Math.sqrt(variance);
    const w = Math.sqrt(Math.max(0, weights[j]));
    for (let i = 0; i < n; i++) {
      X[i][j] = std > 1e-9 ? ((col[i] - mean) / std) * w : 0;
    }
  }

  // Covariance des colonnes C = (1/n) XᵀX (m×m). Trace = variance totale (pour la part expliquée).
  const C: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let a = 0; a < m; a++) {
    for (let b = a; b < m; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[i][a] * X[i][b];
      s /= n;
      C[a][b] = s;
      C[b][a] = s;
    }
  }
  const totalVar = C.reduce((acc, row, i) => acc + row[i], 0) || 1;

  const e1 = dominantEigen(C);
  const C2 = deflate(C, e1.vec, e1.value);
  const e2 = dominantEigen(C2);

  const scores = ids.map((id, i) => {
    const x = X[i].reduce((a, v, j) => a + v * e1.vec[j], 0);
    const y = X[i].reduce((a, v, j) => a + v * e2.vec[j], 0);
    // cos² = ‖projection sur le plan‖² / ‖vecteur standardisé complet‖².
    const sumSq = X[i].reduce((a, v) => a + v * v, 0);
    const cos2 = sumSq > 1e-12 ? (x * x + y * y) / sumSq : 0;
    return { id, x, y, cos2 };
  });

  // Flèches du biplot : direction = composante du vecteur propre, longueur ∝ √λ (importance de l'axe).
  const s1 = Math.sqrt(Math.max(0, e1.value));
  const s2 = Math.sqrt(Math.max(0, e2.value));
  const loadings = keys.map((key, j) => ({
    key,
    x: e1.vec[j] * s1,
    y: e2.vec[j] * s2,
  }));

  return {
    scores,
    loadings,
    explained: [Math.max(0, e1.value) / totalVar, Math.max(0, e2.value) / totalVar],
  };
}
