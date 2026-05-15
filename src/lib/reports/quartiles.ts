/** Pure helpers for the boxplot report.
 *
 * SQLite has no `PERCENTILE_CONT` so we compute quartiles in
 * userland after a single fetch of per-category amounts. Standard
 * type-7 quantile definition (R's default; matches numpy's
 * `numpy.percentile(method='linear')`):
 *
 *   h = (n - 1) * p
 *   q = sorted[floor(h)] + (h - floor(h)) * (sorted[ceil(h)] - sorted[floor(h)])
 *
 * Outliers: Tukey's 1.5·IQR rule.
 *
 * Inputs are assumed positive (the API endpoint passes
 * `ABS(amount)` so income and expense rows are both positive
 * magnitudes). */

export interface FiveNumber {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** Values beyond 1.5·IQR from the box. May be empty. */
  outliers: number[];
  /** Sample count (for tooltips). */
  n: number;
}

export function fiveNumberSummary(values: ReadonlyArray<number>): FiveNumber {
  if (values.length === 0) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0, outliers: [], n: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const outliers: number[] = [];
  let lowestInside = Infinity;
  let highestInside = -Infinity;
  for (const v of sorted) {
    if (v < lowFence || v > highFence) {
      outliers.push(v);
    } else {
      if (v < lowestInside) lowestInside = v;
      if (v > highestInside) highestInside = v;
    }
  }
  // Whiskers extend to the most extreme non-outlier value. If every
  // point is an outlier (degenerate IQR=0 case with mixed values),
  // fall back to actual min/max.
  const min = Number.isFinite(lowestInside) ? lowestInside : sorted[0];
  const max = Number.isFinite(highestInside)
    ? highestInside
    : sorted[sorted.length - 1];
  return { min, q1, median, q3, max, outliers, n: sorted.length };
}

/** Linear-interpolated quantile (type-7). `sorted` must be
 * pre-sorted ascending and non-empty. */
export function quantile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 1) return sorted[0];
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
