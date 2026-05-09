/**
 * App-side trigram similarity matching the Postgres `pg_trgm.similarity()`
 * shape. Used by the categorisation suggester so the import flow doesn't
 * depend on a Postgres-specific extension.
 *
 * Postgres `show_trgm()` pads the input with two leading and one trailing
 * space and slides a 3-char window. `similarity(a, b)` returns
 * |trigrams(a) ∩ trigrams(b)| / |trigrams(a) ∪ trigrams(b)| (Jaccard).
 *
 * This implementation matches that shape exactly so the threshold
 * (SIMILARITY_FLOOR = 0.4 in categorize.ts) keeps its meaning.
 */

/** Compute the trigram set for a string, matching pg_trgm's `show_trgm`.
 * Treats whitespace runs as single spaces, lowercases the input, then
 * pads "  word " before sliding a 3-char window. */
export function trigrams(input: string): Set<string> {
  const out = new Set<string>();
  if (!input) return out;
  // pg_trgm splits on word boundaries (any non-alphanumeric run becomes a
  // boundary). For our purposes a simple normalise to lowercase + collapsed
  // whitespace is enough — most upstream payees have already been
  // normalised (uppercase + token-stripped) before they hit this fn.
  const tokens = input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  for (const token of tokens) {
    // pg_trgm's per-word padding: "  token "
    const padded = `  ${token} `;
    for (let i = 0; i <= padded.length - 3; i++) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/** Jaccard similarity over trigram sets. Result range [0, 1]. Matches
 * Postgres' `similarity(a, b)` to within tokenisation differences (the
 * boundary handling is slightly stricter here). */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let intersection = 0;
  // Iterate the smaller set for fewer hash lookups.
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of small) if (large.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
