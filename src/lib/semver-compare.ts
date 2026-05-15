/** Compares two `X.Y.Z` semver strings.
 *
 * Returns -1 if `a < b`, 0 if equal, 1 if `a > b`. Non-numeric or
 * malformed inputs sort BEFORE valid ones (so a comparison against
 * an upstream string that the registry mangled doesn't accidentally
 * trip the "update available" path). Pre-release / build suffixes
 * aren't supported — the app only ships flat semver.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa == null && pb == null) return 0;
  if (pa == null) return -1;
  if (pb == null) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function parseSemver(s: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
