/** Pure helper for the scatter report's smoothing overlay.
 *
 * Computes a rolling-mean trend over numeric (x, y) points by
 * grouping points into x-windows of width `windowDays * 86400000`
 * ms (or whatever the caller passes as the unit). Returns one
 * output point per window centre that had ≥ 1 input.
 *
 * Why not LOESS: a proper local-regression smoother adds a
 * cubic-weighted kernel and tricube weights, ~150 lines and a
 * couple of edge-case bugs. For the scatter-report use case (give
 * the eye a trend reference, not an inferential model) a sliding
 * arithmetic mean is plenty and survives spiky data without
 * over-smoothing.
 *
 * The function is intentionally pure + framework-free so it can
 * be vitest-tested without a render harness. */

export interface XYPoint {
  x: number;
  y: number;
}

/** Compute a rolling arithmetic mean. Input is assumed to be
 * sorted by `x` ascending; otherwise call `.slice().sort()` first.
 *
 * `windowDays` is in days for the budgets app's date-based x
 * axis — internally we convert to milliseconds and slide.
 *
 * Sparse windows (zero points) are skipped — the output is dense
 * only where the input is. The caller (Recharts `<Line>`) treats
 * gaps fine since data is its own array. */
export function rollingMean(
  points: ReadonlyArray<XYPoint>,
  windowDays: number,
): XYPoint[] {
  if (points.length === 0 || windowDays <= 0) return [];
  const halfMs = (windowDays / 2) * 86_400_000;
  const out: XYPoint[] = [];
  let start = 0;
  let end = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const centre = points[i].x;
    const lo = centre - halfMs;
    const hi = centre + halfMs;
    // Advance `start` past points whose x < lo.
    while (start < points.length && points[start].x < lo) {
      sum -= points[start].y;
      start++;
    }
    // Advance `end` to include points whose x <= hi.
    while (end < points.length && points[end].x <= hi) {
      sum += points[end].y;
      end++;
    }
    const count = end - start;
    if (count > 0) {
      out.push({ x: centre, y: sum / count });
    }
  }
  return out;
}
