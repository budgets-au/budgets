import { describe, expect, it } from "vitest";
import {
  categoryNetTotal,
  categorySignMultiplier,
} from "./reports-aggregation";

describe("categorySignMultiplier", () => {
  it("returns +1 for income categories", () => {
    expect(categorySignMultiplier("income")).toBe(1);
  });

  it("returns -1 for expense categories", () => {
    expect(categorySignMultiplier("expense")).toBe(-1);
  });

  it("treats unknown / null types as expense", () => {
    expect(categorySignMultiplier("transfer")).toBe(-1);
    expect(categorySignMultiplier(null)).toBe(-1);
    expect(categorySignMultiplier("anything-else")).toBe(-1);
  });
});

describe("categoryNetTotal", () => {
  it("sums income as-is — payments add, reversals reduce", () => {
    const total = categoryNetTotal(
      [{ amount: 5000 }, { amount: -100 }, { amount: 200 }],
      "income",
    );
    expect(total).toBe(5100);
  });

  it("negates expense — spends become positive, refunds reduce", () => {
    const total = categoryNetTotal(
      [{ amount: -100 }, { amount: -50 }, { amount: 76 }],
      "expense",
    );
    expect(total).toBe(74); // 100 + 50 - 76
  });

  it("regression: refund-only expense returns negative net", () => {
    // The user's original "+76 refund inflates spent by 76" bug
    // surfaced because SUM(ABS) treated the refund as more spending.
    // The correct net here is -76 (the user is up by 76 in this
    // category) — UI may filter negatives out for the pie, but the
    // raw aggregation is honest.
    expect(categoryNetTotal([{ amount: 76 }], "expense")).toBe(-76);
  });

  it("zero-row category sums to 0 (not NaN)", () => {
    expect(categoryNetTotal([], "expense")).toBe(0);
    expect(categoryNetTotal([], "income")).toBe(0);
  });

  it("matches the food-budget scenario: -50 spend + +76 refund = -26 net", () => {
    // Same numbers as the schedule-view fix used. The reports total
    // should agree with the schedule total in direction and magnitude.
    expect(
      categoryNetTotal(
        [{ amount: -50 }, { amount: 76 }],
        "expense",
      ),
    ).toBe(-26);
  });

  it("uncategorised rows (null type) get the expense sign", () => {
    expect(
      categoryNetTotal([{ amount: -100 }, { amount: 30 }], null),
    ).toBe(70);
  });
});
