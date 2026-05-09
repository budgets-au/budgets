import { describe, it, expect } from "vitest";
import { currentBudgetPeriod, pastBudgetPeriods } from "./budget-period";

describe("currentBudgetPeriod — anchor preservation", () => {
  it("monthly anchor on the 31st re-anchors after short months", () => {
    // Anchor: Jan 31. Periods walk:
    //   P0: Jan 31 → Feb 27 (next anchor Feb 28)
    //   P1: Feb 28 → Mar 30 (next anchor Mar 31)
    //   P2: Mar 31 → Apr 29 (next anchor Apr 30)
    //   P3: Apr 30 → May 30 (next anchor May 31)
    //   P4: May 31 → Jun 29
    // Today = May 5 is in P3.
    expect(currentBudgetPeriod("2026-01-31", "monthly", new Date("2026-05-05"))).toEqual({
      from: "2026-04-30",
      to: "2026-05-30",
    });
    // Today = Mar 15 is in P1 (Feb 28 → Mar 30).
    expect(currentBudgetPeriod("2026-01-31", "monthly", new Date("2026-03-15"))).toEqual({
      from: "2026-02-28",
      to: "2026-03-30",
    });
    // Today exactly on the anchor day.
    expect(currentBudgetPeriod("2026-01-31", "monthly", new Date("2026-04-30"))).toEqual({
      from: "2026-04-30",
      to: "2026-05-30",
    });
  });

  it("monthly anchor on a mid-month day is unaffected", () => {
    expect(currentBudgetPeriod("2026-01-15", "monthly", new Date("2026-03-20"))).toEqual({
      from: "2026-03-15",
      to: "2026-04-14",
    });
  });

  it("weekly anchor walks 7 days at a time", () => {
    // Mon Jan 5 + 7 weeks = Mon Feb 23. Period containing Feb 25 is Feb 23 → Mar 1.
    expect(currentBudgetPeriod("2026-01-05", "weekly", new Date("2026-02-25"))).toEqual({
      from: "2026-02-23",
      to: "2026-03-01",
    });
  });

  it("quarterly anchor preserves day after short-month rollover", () => {
    // Anchor Jan 31, quarterly. Anchors: Jan 31, Apr 30, Jul 31, Oct 31, Jan 31.
    // Today = May 1 is in P1 (Apr 30 → Jul 30).
    expect(currentBudgetPeriod("2026-01-31", "quarterly", new Date("2026-05-01"))).toEqual({
      from: "2026-04-30",
      to: "2026-07-30",
    });
  });

  it("yearly anchor on Feb 29 doesn't drift in non-leap years", () => {
    // Feb 29 2024 (leap). Year+1 lands on Feb 28 2025; period ends Feb 27 2026.
    // After 2026-03-01, we're in P2 starting Feb 28 2026.
    // Today = Mar 15 2026 is in P2.
    expect(currentBudgetPeriod("2024-02-29", "yearly", new Date("2026-03-15"))).toEqual({
      from: "2026-02-28",
      to: "2027-02-27",
    });
  });

  it("today before the start date returns the first period", () => {
    // Schedule starts in the future — UI shouldn't crash; return the
    // schedule's first period so progress reads 0%.
    expect(currentBudgetPeriod("2026-12-01", "monthly", new Date("2026-05-01"))).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("daily / fortnightly fall back to a single-day window", () => {
    expect(currentBudgetPeriod("2026-01-01", "daily", new Date("2026-05-06"))).toEqual({
      from: "2026-05-06",
      to: "2026-05-06",
    });
  });
});

describe("pastBudgetPeriods", () => {
  it("emits every period from start through the one containing today", () => {
    const periods = pastBudgetPeriods("2026-01-31", "monthly", new Date("2026-05-05"));
    expect(periods).toEqual([
      { from: "2026-01-31", to: "2026-02-27" },
      { from: "2026-02-28", to: "2026-03-30" },
      { from: "2026-03-31", to: "2026-04-29" },
      { from: "2026-04-30", to: "2026-05-30" },
    ]);
  });

  it("clips to windowFrom — periods whose `to` predates the window are skipped", () => {
    const periods = pastBudgetPeriods(
      "2026-01-31",
      "monthly",
      new Date("2026-05-05"),
      "2026-04-01",
    );
    // P0 (ends Feb 27) and P1 (ends Mar 30) are before the window; drop them.
    expect(periods).toEqual([
      { from: "2026-03-31", to: "2026-04-29" },
      { from: "2026-04-30", to: "2026-05-30" },
    ]);
  });

  it("returns empty for unsupported frequency", () => {
    expect(pastBudgetPeriods("2026-01-01", "daily", new Date("2026-05-05"))).toEqual([]);
  });
});
