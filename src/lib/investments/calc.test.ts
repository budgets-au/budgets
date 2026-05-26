import { describe, expect, it } from "vitest";
import type { Investment, InvestmentVest } from "@/db/schema";
import {
  costBasis,
  currentValue,
  dividendsReceived,
  optionIntrinsic,
  totalReturn,
  vestedQuantity,
} from "./calc";

/** The functions in `calc.ts` only read a subset of the full
 *  Investment / InvestmentVest rows — `Pick<>` lets us hand in
 *  thin fixtures without spelling out every column the schema
 *  carries. */
function inv(
  partial: Partial<Investment> & { kind: Investment["kind"] },
): Investment {
  return {
    quantity: "0",
    purchasePrice: null,
    strikePrice: null,
    purchaseDate: "2026-01-01",
    ...(partial as object),
  } as Investment;
}
function vest(
  vestDate: string,
  quantity: string,
  isSatisfied = true,
): InvestmentVest {
  return { vestDate, quantity, isSatisfied } as InvestmentVest;
}

describe("vestedQuantity", () => {
  it("stocks always return their full quantity (no schedule applies)", () => {
    expect(vestedQuantity(inv({ kind: "stock", quantity: "100" }), [])).toBe(100);
    expect(
      vestedQuantity(inv({ kind: "stock", quantity: "100" }), [
        vest("2030-01-01", "999"),
      ]),
    ).toBe(100);
  });

  it("paper trades with no vests default to fully vested", () => {
    expect(vestedQuantity(inv({ kind: "paper", quantity: "50" }), [])).toBe(50);
  });

  it("paper trades with vests respect the schedule", () => {
    const today = new Date("2026-06-01T00:00:00Z");
    expect(
      vestedQuantity(
        inv({ kind: "paper", quantity: "100" }),
        [vest("2026-01-01", "30"), vest("2026-07-01", "70")],
        today,
      ),
    ).toBe(30);
  });

  it("RSU sums vests with date ≤ today AND is_satisfied", () => {
    const today = new Date("2026-06-01T00:00:00Z");
    expect(
      vestedQuantity(
        inv({ kind: "rsu", quantity: "100" }),
        [
          vest("2026-01-01", "25"),
          vest("2026-04-01", "25"),
          vest("2026-08-01", "25"), // future
          vest("2026-05-01", "25", false), // unmet performance hurdle
        ],
        today,
      ),
    ).toBe(50);
  });

  it("RSU returns 0 when nothing has vested yet", () => {
    const today = new Date("2025-12-01T00:00:00Z");
    expect(
      vestedQuantity(
        inv({ kind: "rsu", quantity: "100" }),
        [vest("2026-01-01", "25")],
        today,
      ),
    ).toBe(0);
  });
});

describe("costBasis", () => {
  it("multiplies quantity × purchasePrice", () => {
    expect(
      costBasis(inv({ kind: "stock", quantity: "10", purchasePrice: "12.50" })),
    ).toBe(125);
  });
  it("treats null purchasePrice as 0 (typical RSU grants)", () => {
    expect(
      costBasis(inv({ kind: "rsu", quantity: "100", purchasePrice: null })),
    ).toBe(0);
  });
});

describe("currentValue", () => {
  it("stocks: quantity × current price", () => {
    expect(currentValue(inv({ kind: "stock", quantity: "20" }), 5)).toBe(100);
  });
  it("RSU with no strike: quantity × current price", () => {
    expect(currentValue(inv({ kind: "rsu", quantity: "10" }), 7.5)).toBe(75);
  });
  it("option with strike — out-of-the-money returns 0", () => {
    expect(
      currentValue(
        inv({ kind: "option", quantity: "100", strikePrice: "10" }),
        7,
      ),
    ).toBe(0);
  });
  it("option with strike — in-the-money returns intrinsic × qty", () => {
    expect(
      currentValue(
        inv({ kind: "option", quantity: "100", strikePrice: "10" }),
        12.5,
      ),
    ).toBe(250); // (12.5 - 10) * 100
  });
});

describe("dividendsReceived", () => {
  it("ignores dividends paid before the purchase date", () => {
    const i = inv({ kind: "stock", purchaseDate: "2026-03-01" });
    expect(
      dividendsReceived(i, [], 100, [
        { date: "2026-02-01", amount: 0.5 },
        { date: "2026-04-01", amount: 0.5 },
      ]),
    ).toBe(50); // only April counted
  });

  it("stocks: quantity × amount per event", () => {
    const i = inv({ kind: "stock", purchaseDate: "2026-01-01" });
    expect(
      dividendsReceived(i, [], 200, [
        { date: "2026-03-01", amount: 0.25 },
        { date: "2026-09-01", amount: 0.35 },
      ]),
    ).toBeCloseTo(120, 2); // 200*(0.25+0.35)
  });

  it("RSU: only the vested-as-of ex-date counts toward each event", () => {
    const i = inv({ kind: "rsu", purchaseDate: "2026-01-01" });
    const vests = [vest("2026-04-01", "10"), vest("2026-10-01", "10")];
    const events = [
      { date: "2026-06-01", amount: 1 }, // first 10 vested
      { date: "2026-12-01", amount: 1 }, // both 20 vested
    ];
    expect(dividendsReceived(i, vests, 100 /* ignored */, events)).toBe(30);
  });
});

describe("totalReturn", () => {
  it("absolute = current + dividends − basis", () => {
    expect(totalReturn(1000, 1200, 50)).toEqual({
      absolute: 250,
      percent: 0.25,
    });
  });
  it("percent is null when cost basis is 0 (RSU with no purchasePrice)", () => {
    expect(totalReturn(0, 500, 10)).toEqual({ absolute: 510, percent: null });
  });
});

describe("optionIntrinsic", () => {
  it("returns 0 for non-option kinds", () => {
    expect(
      optionIntrinsic(inv({ kind: "stock", strikePrice: "5" }), 100, 50),
    ).toBe(0);
    expect(
      optionIntrinsic(inv({ kind: "rsu", strikePrice: "5" }), 100, 50),
    ).toBe(0);
  });
  it("max(0, currentPrice − strike) × vestedQty", () => {
    const i = inv({ kind: "option", strikePrice: "10" });
    expect(optionIntrinsic(i, 12.5, 100)).toBe(250);
    expect(optionIntrinsic(i, 8, 100)).toBe(0); // OTM
  });
});
