import { describe, it, expect } from "vitest";
import {
  topMovers,
  streaksOverPlan,
  newThisMonth,
  fastestGrowing,
} from "./anomaly-calcs";
import type { CashflowCategory } from "@/app/api/reports/cashflow/route";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

/** Build a category quickly for tests. `byMonth` uses signed values
 *  (expenses negative) exactly like the API payload. */
function cat(
  overrides: Partial<CashflowCategory> & {
    id: string;
    name: string;
    byMonth: Record<string, number>;
  },
): CashflowCategory {
  return {
    id: overrides.id,
    name: overrides.name,
    parentId: overrides.parentId ?? null,
    parentName: overrides.parentName ?? null,
    grandparentId: overrides.grandparentId ?? null,
    grandparentName: overrides.grandparentName ?? null,
    type: overrides.type ?? "expense",
    byMonth: overrides.byMonth,
    countByMonth: overrides.countByMonth ?? {},
    total: overrides.total ?? 0,
    totalCount: overrides.totalCount ?? 0,
    budgetTotal: overrides.budgetTotal ?? 0,
    scheduledTotal: overrides.scheduledTotal ?? 0,
    budgetByMonth: overrides.budgetByMonth ?? {},
    scheduledByMonth: overrides.scheduledByMonth ?? {},
  };
}

describe("topMovers", () => {
  it("ranks categories by |current - 3-month avg|", () => {
    const cats = [
      cat({
        id: "g",
        name: "Groceries",
        byMonth: {
          "2026-03": -400,
          "2026-04": -420,
          "2026-05": -380,
          "2026-06": -900, // big spike
        },
      }),
      cat({
        id: "f",
        name: "Fuel",
        byMonth: {
          "2026-03": -150,
          "2026-04": -160,
          "2026-05": -140,
          "2026-06": -160, // steady
        },
      }),
    ];
    const rows = topMovers(cats, MONTHS, 5);
    expect(rows[0].categoryId).toBe("g");
    expect(rows[0].currentMonth).toBe(900);
    expect(rows[0].rollingAvg).toBe(400);
    expect(rows[0].delta).toBe(500);
  });

  it("returns [] when fewer than 4 months of data", () => {
    expect(topMovers([], ["2026-01", "2026-02"], 5)).toEqual([]);
  });

  it("skips rows with <$5 delta", () => {
    const rows = topMovers(
      [
        cat({
          id: "x",
          name: "X",
          byMonth: {
            "2026-03": -100,
            "2026-04": -102,
            "2026-05": -99,
            "2026-06": -101,
          },
        }),
      ],
      MONTHS,
      5,
    );
    expect(rows).toEqual([]);
  });
});

describe("streaksOverPlan", () => {
  it("counts consecutive months where actual > plan, ending in current", () => {
    const cats = [
      cat({
        id: "d",
        name: "Dining",
        byMonth: {
          "2026-04": -200,
          "2026-05": -250,
          "2026-06": -300,
        },
        // Uniform $150/mo plan
        budgetByMonth: {
          "2026-04": 150,
          "2026-05": 150,
          "2026-06": 150,
        },
      }),
    ];
    const rows = streaksOverPlan(cats, MONTHS, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0].streakLength).toBe(3);
    // Overspend: (200-150) + (250-150) + (300-150) = 300
    expect(rows[0].totalOverspend).toBe(300);
  });

  it("skips a single overspend month (needs ≥ 2)", () => {
    const cats = [
      cat({
        id: "d",
        name: "Dining",
        byMonth: {
          "2026-05": -100,
          "2026-06": -300,
        },
        budgetByMonth: {
          "2026-05": 150,
          "2026-06": 150,
        },
      }),
    ];
    expect(streaksOverPlan(cats, MONTHS, 5)).toEqual([]);
  });

  it("breaks the streak on the first non-overspend month walking backwards", () => {
    const cats = [
      cat({
        id: "d",
        name: "Dining",
        byMonth: {
          "2026-03": -100, // under
          "2026-04": -200, // over
          "2026-05": -200, // over
          "2026-06": -200, // over
        },
        budgetByMonth: {
          "2026-03": 150,
          "2026-04": 150,
          "2026-05": 150,
          "2026-06": 150,
        },
      }),
    ];
    const rows = streaksOverPlan(cats, MONTHS, 5);
    expect(rows[0].streakLength).toBe(3);
  });

  it("ignores categories without a plan (budget or scheduled)", () => {
    const cats = [
      cat({
        id: "misc",
        name: "Misc",
        byMonth: {
          "2026-05": -500,
          "2026-06": -600,
        },
      }),
    ];
    expect(streaksOverPlan(cats, MONTHS, 5)).toEqual([]);
  });
});

describe("newThisMonth", () => {
  it("surfaces categories with $0 in prior 3 months but non-zero now", () => {
    const cats = [
      cat({
        id: "sub",
        name: "Netflix",
        byMonth: {
          "2026-06": -15,
        },
      }),
      cat({
        id: "old",
        name: "Rent",
        byMonth: {
          "2026-04": -2000,
          "2026-05": -2000,
          "2026-06": -2000,
        },
      }),
    ];
    const rows = newThisMonth(cats, MONTHS, 5);
    expect(rows.map((r) => r.categoryId)).toEqual(["sub"]);
    expect(rows[0].currentMonth).toBe(15);
  });

  it("returns [] when fewer than 4 months of data", () => {
    expect(newThisMonth([], ["2026-01", "2026-02", "2026-03"], 5)).toEqual([]);
  });
});

describe("fastestGrowing", () => {
  it("ranks by (current - baseline) / baseline where baseline = 3 mo ago", () => {
    const cats = [
      cat({
        id: "streaming",
        name: "Streaming",
        // baseline in 2026-03 = 20, current in 2026-06 = 80 → 300% growth
        byMonth: {
          "2026-03": -20,
          "2026-06": -80,
        },
      }),
      cat({
        id: "small",
        name: "Small",
        // baseline < $20 → excluded (avoids meaningless % explosions)
        byMonth: {
          "2026-03": -5,
          "2026-06": -50,
        },
      }),
    ];
    const rows = fastestGrowing(cats, MONTHS, 5);
    expect(rows.map((r) => r.categoryId)).toEqual(["streaming"]);
    expect(rows[0].growthPct).toBe(3);
  });

  it("skips rows that shrank or held flat", () => {
    const cats = [
      cat({
        id: "flat",
        name: "Flat",
        byMonth: {
          "2026-03": -100,
          "2026-06": -100,
        },
      }),
      cat({
        id: "shrunk",
        name: "Shrunk",
        byMonth: {
          "2026-03": -100,
          "2026-06": -50,
        },
      }),
    ];
    expect(fastestGrowing(cats, MONTHS, 5)).toEqual([]);
  });
});
