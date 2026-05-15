import { describe, expect, it } from "vitest";
import { compareSemver } from "./semver-compare";

describe("compareSemver", () => {
  it("equal strings compare to 0", () => {
    expect(compareSemver("0.82.0", "0.82.0")).toBe(0);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
  });

  it("patch differences", () => {
    expect(compareSemver("0.82.0", "0.82.1")).toBe(-1);
    expect(compareSemver("0.82.1", "0.82.0")).toBe(1);
  });

  it("minor differences", () => {
    expect(compareSemver("0.82.0", "0.83.0")).toBe(-1);
    expect(compareSemver("0.83.0", "0.82.99")).toBe(1);
  });

  it("major differences", () => {
    expect(compareSemver("0.99.99", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
  });

  it("numeric (not lexicographic) compare", () => {
    // Catches the classic "10 < 2" string-sort bug.
    expect(compareSemver("0.10.0", "0.2.0")).toBe(1);
    expect(compareSemver("0.2.0", "0.10.0")).toBe(-1);
  });

  it("malformed strings sort before valid ones", () => {
    expect(compareSemver("not-a-version", "0.1.0")).toBe(-1);
    expect(compareSemver("0.1.0", "garbage")).toBe(1);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(-1); // leading "v" not allowed
    expect(compareSemver("garbage", "trash")).toBe(0);
  });
});
