/** Normalisation d'un nom d'aliment : minuscules, sans accents, singulier naïf. */

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Singulier naïf mot à mot : retire un s/x final (sauf mots courts et exceptions). */
function singularizeWord(w: string): string {
  const exceptions = new Set(['pois', 'anis', 'jus', 'riz', 'os', 'ananas', 'radis', 'cassis', 'mais', 'couscous', 'pas', 'bras']);
  if (w.length <= 3 || exceptions.has(w)) return w;
  if (w.endsWith('aux')) return w.slice(0, -3) + 'al'; // chevaux → cheval (approx.)
  if (w.endsWith('s') || w.endsWith('x')) return w.slice(0, -1);
  return w;
}

export function normalize(text: string): string {
  return stripAccents(text.toLowerCase())
    .replace(/[''`]/g, "'")
    .replace(/[^a-z0-9'%\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalisation + singulier, pour le matching. */
export function normalizeForMatch(text: string): string {
  return normalize(text)
    .split(' ')
    .map(singularizeWord)
    .join(' ');
}

/** Trigrammes de caractères pour similarité fuzzy. */
export function trigrams(s: string): Set<string> {
  const padded = `  ${s} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}
