import { describe, it, expect } from "vitest";
import {
  calculateTaxReport,
  classifyCategoryDefault,
  type TaxTxn,
} from "./calc";
import { currentFyEndYear, fyDateRange } from "./fy";
import type { TaxConfig } from "@/db/schema";
import type { CategoryLike } from "@/lib/category-path";

const CATS: CategoryLike[] = [
  { id: "utilities", name: "Utilities", parentId: null },
  { id: "electricity", name: "Electricity", parentId: "utilities" },
  { id: "internet", name: "Internet", parentId: null },
  { id: "donations", name: "Donations", parentId: null },
  { id: "development", name: "Development", parentId: null },
  { id: "tax", name: "Tax", parentId: null },
  { id: "accountant", name: "Accountant", parentId: "tax" },
  { id: "groceries", name: "Groceries", parentId: null },
];

const FY = 2025;
const range = fyDateRange(FY);

describe("classifyCategoryDefault", () => {
  it("flags utilities/electricity as bundled", () => {
    expect(classifyCategoryDefault(["Utilities", "Electricity"])).toMatchObject({
      bundledInWfh: true,
      section: null,
    });
  });

  it("flags Internet as bundled", () => {
    expect(classifyCategoryDefault(["Internet"]).bundledInWfh).toBe(true);
  });

  it("classifies Donations into the donations section", () => {
    expect(classifyCategoryDefault(["Donations"]).section).toBe("donations");
  });

  it("classifies Tax / Accountant into tax-agent", () => {
    expect(
      classifyCategoryDefault(["Tax", "Accountant"]).section,
    ).toBe("tax-agent");
  });

  it("returns null section for unknown categories (no auto-claim)", () => {
    expect(classifyCategoryDefault(["Random"])).toEqual({
      bundledInWfh: false,
      section: null,
      defaultPct: 0,
    });
  });
});

describe("calculateTaxReport — fixed-rate WFH", () => {
  it("fixed claim = rate × hours", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      config: { wfhHoursByFy: { [FY]: 100 }, categoryRules: {} } as TaxConfig,
      categories: CATS,
      txns: [],
    });
    expect(r.wfh.fixed).toMatchObject({ rate: 0.7, hours: 100, claim: 70 });
  });

  it("warns when no WFH hours are recorded for the year", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      config: { wfhHoursByFy: {}, categoryRules: {} } as TaxConfig,
      categories: CATS,
      txns: [],
    });
    expect(r.wfh.fixed.claim).toBe(0);
    expect(r.warnings.some((w) => /No WFH hours recorded/i.test(w))).toBe(true);
  });

  it("warns when the FY rate is unknown (fallback)", () => {
    const r = calculateTaxReport({
      fyEndYear: 2099,
      fyRange: fyDateRange(2099),
      config: { wfhHoursByFy: { 2099: 100 }, categoryRules: {} } as TaxConfig,
      categories: CATS,
      txns: [],
    });
    expect(r.warnings.some((w) => /No published ATO fixed rate/i.test(w))).toBe(
      true,
    );
  });
});

describe("calculateTaxReport — bundled vs other deductions", () => {
  const txns: TaxTxn[] = [
    { categoryId: "electricity", amount: -1000 },
    { categoryId: "internet", amount: -800 },
    { categoryId: "donations", amount: -300 },
    { categoryId: "accountant", amount: -200 },
    { categoryId: "groceries", amount: -500 }, // pure personal, no claim
  ];

  it("bundled categories don't appear in otherDeductions", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      config: {
        wfhHoursByFy: { [FY]: 100 },
        categoryRules: {
          electricity: { workUsePct: 30, bundledInWfh: true },
          internet: { workUsePct: 50, bundledInWfh: true },
          donations: { workUsePct: 100, bundledInWfh: false },
          accountant: { workUsePct: 100, bundledInWfh: false },
        },
      } as TaxConfig,
      categories: CATS,
      txns,
    });
    const otherIds = r.otherDeductions.map((o) => o.categoryId);
    expect(otherIds).not.toContain("electricity");
    expect(otherIds).not.toContain("internet");
    expect(otherIds).toContain("donations");
    expect(otherIds).toContain("accountant");
  });

  it("actual-cost wfh sums claimable across bundled categories", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      config: {
        wfhHoursByFy: { [FY]: 100 },
        categoryRules: {
          electricity: { workUsePct: 30, bundledInWfh: true },
          internet: { workUsePct: 50, bundledInWfh: true },
        },
      } as TaxConfig,
      categories: CATS,
      txns,
    });
    // Electricity: 1000 * 30% = 300; Internet: 800 * 50% = 400; total 700.
    expect(r.wfh.actual.claim).toBe(700);
    // recommended: actual (700) > fixed (70).
    expect(r.wfh.recommended).toBe("actual");
  });

  it("recommends fixed when fixed > actual", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      config: {
        // 1000 hours × $0.70 = $700 fixed.
        wfhHoursByFy: { [FY]: 1000 },
        categoryRules: {
          electricity: { workUsePct: 30, bundledInWfh: true }, // 300
        },
      } as TaxConfig,
      categories: CATS,
      txns,
    });
    expect(r.wfh.recommended).toBe("fixed");
  });

  it("ties go to fixed (recommended = fixed when equal)", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      // fixed = 100 * 0.70 = 70; actual = 1000 * 7% = 70.
      config: {
        wfhHoursByFy: { [FY]: 100 },
        categoryRules: { electricity: { workUsePct: 7, bundledInWfh: true } },
      } as TaxConfig,
      categories: CATS,
      txns,
    });
    expect(r.wfh.actual.claim).toBe(70);
    expect(r.wfh.fixed.claim).toBe(70);
    expect(r.wfh.recommended).toBe("fixed");
  });
});

describe("calculateTaxReport — refunds shrink magnitudes", () => {
  it("a positive refund reduces total magnitude on the same category", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      config: {
        wfhHoursByFy: { [FY]: 0 },
        categoryRules: { donations: { workUsePct: 100, bundledInWfh: false } },
      } as TaxConfig,
      categories: CATS,
      txns: [
        { categoryId: "donations", amount: -200 },
        { categoryId: "donations", amount: 50 }, // refund
      ],
    });
    // Net signed -150, |-150| = 150 claimable at 100%.
    expect(r.otherDeductions[0].total).toBe(150);
    expect(r.otherDeductions[0].claimable).toBe(150);
  });
});

describe("calculateTaxReport — section ordering", () => {
  it("groups otherDeductions tax-agent → donations → subscriptions → other", () => {
    const r = calculateTaxReport({
      fyEndYear: FY,
      fyRange: range,
      config: {
        wfhHoursByFy: { [FY]: 0 },
        categoryRules: {
          donations: { workUsePct: 100, bundledInWfh: false },
          accountant: { workUsePct: 100, bundledInWfh: false },
          development: { workUsePct: 100, bundledInWfh: false },
        },
      } as TaxConfig,
      categories: CATS,
      txns: [
        { categoryId: "donations", amount: -100 },
        { categoryId: "accountant", amount: -300 },
        { categoryId: "development", amount: -50 },
      ],
    });
    expect(r.otherDeductions.map((o) => o.section)).toEqual([
      "tax-agent",
      "donations",
      "subscriptions",
    ]);
  });
});

describe("currentFyEndYear", () => {
  it("June 30 belongs to the FY ending this calendar year", () => {
    expect(currentFyEndYear(new Date("2026-06-30"))).toBe(2026);
  });

  it("July 1 belongs to next FY", () => {
    expect(currentFyEndYear(new Date("2026-07-01"))).toBe(2027);
  });

  it("January 1 belongs to the FY ending this calendar year", () => {
    expect(currentFyEndYear(new Date("2026-01-01"))).toBe(2026);
  });
});
