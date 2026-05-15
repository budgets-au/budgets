import { describe, expect, it } from "vitest";
import { rollingMean } from "./rolling-mean";

describe("rollingMean", () => {
  it("returns an empty array for empty input", () => {
    expect(rollingMean([], 7)).toEqual([]);
  });

  it("returns an empty array for non-positive window", () => {
    expect(rollingMean([{ x: 0, y: 1 }], 0)).toEqual([]);
    expect(rollingMean([{ x: 0, y: 1 }], -3)).toEqual([]);
  });

  it("averages a window centred on each point", () => {
    // Five daily points; a 3-day window centres ±1.5 days, so each
    // mean covers ~3 neighbours (the point + its immediate sides).
    const day = 86_400_000;
    const pts = [
      { x: 0 * day, y: 10 },
      { x: 1 * day, y: 20 },
      { x: 2 * day, y: 30 },
      { x: 3 * day, y: 40 },
      { x: 4 * day, y: 50 },
    ];
    const out = rollingMean(pts, 3);
    // First point: 10 + 20 = 30, /2 = 15
    expect(out[0]).toEqual({ x: 0, y: 15 });
    // Middle point (index 2): 20 + 30 + 40 = 90, /3 = 30
    expect(out[2]).toEqual({ x: 2 * day, y: 30 });
    // Last point: 40 + 50 = 90, /2 = 45
    expect(out[4]).toEqual({ x: 4 * day, y: 45 });
  });

  it("handles a single point", () => {
    expect(rollingMean([{ x: 100, y: 7 }], 5)).toEqual([{ x: 100, y: 7 }]);
  });

  it("does not include points outside the window", () => {
    const day = 86_400_000;
    // 10-day-wide window centred on point 0; point at +10 days is
    // outside ±5 days so should not contribute to point 0's mean.
    const pts = [
      { x: 0, y: 1 },
      { x: 10 * day, y: 999 },
    ];
    const out = rollingMean(pts, 9);
    expect(out[0].y).toBe(1);
    expect(out[1].y).toBe(999);
  });

  it("survives duplicate x values without divide-by-zero", () => {
    const out = rollingMean(
      [
        { x: 0, y: 2 },
        { x: 0, y: 4 },
        { x: 0, y: 6 },
      ],
      7,
    );
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.y === 4)).toBe(true);
  });
});
