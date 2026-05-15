import { describe, expect, it } from "vitest";
import { fiveNumberSummary, quantile } from "./quartiles";

describe("quantile (type-7 / linear)", () => {
  it("returns the only value for a single-element sample", () => {
    expect(quantile([42], 0.5)).toBe(42);
    expect(quantile([42], 0)).toBe(42);
    expect(quantile([42], 1)).toBe(42);
  });

  it("matches numpy's default for an odd-length sorted array", () => {
    const xs = [1, 2, 3, 4, 5];
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 0.25)).toBe(2);
    expect(quantile(xs, 0.5)).toBe(3);
    expect(quantile(xs, 0.75)).toBe(4);
    expect(quantile(xs, 1)).toBe(5);
  });

  it("interpolates for even-length samples", () => {
    const xs = [1, 2, 3, 4];
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(quantile(xs, 0.25)).toBe(1.75);
    expect(quantile(xs, 0.75)).toBe(3.25);
  });
});

describe("fiveNumberSummary", () => {
  it("returns zeroes for empty input", () => {
    expect(fiveNumberSummary([])).toEqual({
      min: 0,
      q1: 0,
      median: 0,
      q3: 0,
      max: 0,
      outliers: [],
      n: 0,
    });
  });

  it("computes a standard five-number summary", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const s = fiveNumberSummary(xs);
    expect(s.median).toBe(5);
    expect(s.q1).toBe(3);
    expect(s.q3).toBe(7);
    expect(s.n).toBe(9);
  });

  it("flags Tukey outliers (1.5 · IQR)", () => {
    // 1..9 has IQR=4, fences at -3 and 13. Add a 50 outlier.
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 50];
    const s = fiveNumberSummary(xs);
    expect(s.outliers).toEqual([50]);
    // Whisker max should clamp to the largest non-outlier.
    expect(s.max).toBe(9);
  });

  it("does not flag tight distributions as outliers", () => {
    const xs = [10, 10, 10, 11, 11, 11, 12];
    const s = fiveNumberSummary(xs);
    expect(s.outliers).toEqual([]);
  });
});
