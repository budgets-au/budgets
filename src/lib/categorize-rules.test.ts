import { describe, it, expect } from "vitest";
import { rangeContains, pickMostSpecific, type RuleRow } from "./categorize";

function rule(over: Partial<RuleRow> = {}): RuleRow {
  return {
    categoryId: "cat-1",
    minAmount: null,
    maxAmount: null,
    ...over,
  };
}

describe("rangeContains", () => {
  it("unbounded rule contains every amount", () => {
    expect(rangeContains(rule(), 100)).toBe(true);
    expect(rangeContains(rule(), -1_000_000)).toBe(true);
    expect(rangeContains(rule(), 0)).toBe(true);
  });

  it("min-only rule includes everything ≥ min", () => {
    const r = rule({ minAmount: "10.00" });
    expect(rangeContains(r, 10)).toBe(true);
    expect(rangeContains(r, 1000)).toBe(true);
    expect(rangeContains(r, 9.99)).toBe(false);
  });

  it("max-only rule includes everything ≤ max", () => {
    const r = rule({ maxAmount: "100.00" });
    expect(rangeContains(r, 100)).toBe(true);
    expect(rangeContains(r, 0)).toBe(true);
    expect(rangeContains(r, 100.01)).toBe(false);
  });

  it("bounded rule includes endpoints (closed interval)", () => {
    const r = rule({ minAmount: "50.00", maxAmount: "150.00" });
    expect(rangeContains(r, 50)).toBe(true);
    expect(rangeContains(r, 150)).toBe(true);
    expect(rangeContains(r, 100)).toBe(true);
    expect(rangeContains(r, 49.99)).toBe(false);
    expect(rangeContains(r, 150.01)).toBe(false);
  });

  it("handles negative-amount rules (transfers / refunds)", () => {
    const r = rule({ minAmount: "-200.00", maxAmount: "-100.00" });
    expect(rangeContains(r, -150)).toBe(true);
    expect(rangeContains(r, -100)).toBe(true);
    expect(rangeContains(r, -200)).toBe(true);
    expect(rangeContains(r, -50)).toBe(false);
  });
});

describe("pickMostSpecific", () => {
  it("returns null for empty input", () => {
    expect(pickMostSpecific([])).toBe(null);
  });

  it("ignores rules with null categoryId", () => {
    expect(pickMostSpecific([rule({ categoryId: null })])).toBe(null);
  });

  it("picks the only candidate when there's one rule", () => {
    expect(pickMostSpecific([rule({ categoryId: "only" })])).toBe("only");
  });

  it("a bounded rule beats an unbounded rule (smaller span wins)", () => {
    const unbounded = rule({ categoryId: "general" });
    const bounded = rule({ categoryId: "specific", minAmount: "10", maxAmount: "20" });
    expect(pickMostSpecific([unbounded, bounded])).toBe("specific");
    // Order shouldn't matter — span is the discriminator.
    expect(pickMostSpecific([bounded, unbounded])).toBe("specific");
  });

  it("a tighter bounded rule beats a looser bounded rule", () => {
    const wide = rule({ categoryId: "wide", minAmount: "0", maxAmount: "100" });
    const narrow = rule({ categoryId: "narrow", minAmount: "40", maxAmount: "60" });
    expect(pickMostSpecific([wide, narrow])).toBe("narrow");
    expect(pickMostSpecific([narrow, wide])).toBe("narrow");
  });

  it("a half-open rule (min only) loses to a fully bounded one", () => {
    const halfOpen = rule({ categoryId: "half", minAmount: "10", maxAmount: null });
    const bounded = rule({ categoryId: "bounded", minAmount: "0", maxAmount: "1000000" });
    // halfOpen has Infinity span (max null); bounded has finite span. The
    // bounded one wins regardless of how wide its bounded interval is.
    expect(pickMostSpecific([halfOpen, bounded])).toBe("bounded");
  });

  it("equal-span tiebreaker is stable on first-best (current behaviour)", () => {
    const a = rule({ categoryId: "a", minAmount: "0", maxAmount: "100" });
    const b = rule({ categoryId: "b", minAmount: "100", maxAmount: "200" });
    // Both span 100; the iteration order picks the FIRST one with that
    // best span — `<` not `<=` in ruleSpan. Lock that in so a future
    // refactor doesn't silently flip categories on ties.
    expect(pickMostSpecific([a, b])).toBe("a");
    expect(pickMostSpecific([b, a])).toBe("b");
  });
});
