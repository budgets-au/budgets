import { describe, expect, it } from "vitest";
import {
  amountClass,
  cn,
  diffDaysISO,
  formatAmount,
  formatAUD,
  formatAUDShort,
  formatDate,
  formatDateShort,
  formatMonthYear,
  numFmt,
  toISO,
} from "./utils";

describe("cn", () => {
  it("merges class strings and dedupes via tailwind-merge", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false && "hidden", "font-bold")).toContain("text-sm");
  });
});

describe("formatAUDShort", () => {
  it("strips the A$ country prefix, leaving $ + amount", () => {
    expect(formatAUDShort(100)).toBe("$100.00");
    expect(formatAUDShort(1234.56)).toBe("$1,234.56");
  });
  it("preserves the leading minus on negative amounts", () => {
    expect(formatAUDShort(-50)).toBe("-$50.00");
  });
  it("matches formatAUD(x).replace('A$', '$') for parity", () => {
    for (const v of [0, 10, -10, 1234567, -0.99, 12.345]) {
      expect(formatAUDShort(v)).toBe(formatAUD(v).replace("A$", "$"));
    }
  });
});

describe("formatAUD", () => {
  it("renders integers with the AUD symbol and two decimals", () => {
    expect(formatAUD(100)).toBe("$100.00");
    expect(formatAUD(0)).toBe("$0.00");
  });
  it("accepts string input", () => {
    expect(formatAUD("42.5")).toBe("$42.50");
  });
  it("renders negative amounts with a leading minus", () => {
    expect(formatAUD(-12.34)).toBe("-$12.34");
  });
});

describe("formatAmount", () => {
  it("renders number-or-string to a 2dp string", () => {
    expect(formatAmount(123)).toBe("123.00");
    expect(formatAmount("45.6")).toBe("45.60");
    expect(formatAmount(-7.891)).toBe("-7.89");
  });
  it("returns '0.00' for non-finite or unparseable input", () => {
    expect(formatAmount("not a number")).toBe("0.00");
    expect(formatAmount(NaN)).toBe("0.00");
    expect(formatAmount(Infinity)).toBe("0.00");
  });
});

describe("formatDate / formatDateShort / formatMonthYear", () => {
  it("formats ISO date strings", () => {
    expect(formatDate("2026-05-26")).toBe("26 May 2026");
    expect(formatDateShort("2026-05-26")).toBe("26 May");
    expect(formatMonthYear("2026-05-26")).toBe("May 2026");
  });
  it("formats Date objects", () => {
    const d = new Date(2026, 4, 26); // May (0-indexed) 26, 2026
    expect(formatDate(d)).toBe("26 May 2026");
    expect(formatDateShort(d)).toBe("26 May");
    expect(formatMonthYear(d)).toBe("May 2026");
  });
});

describe("amountClass", () => {
  const POSITIVE = "text-emerald-600 dark:text-emerald-400";
  const NEGATIVE = "text-red-500 dark:text-red-400";
  const NEUTRAL = "text-muted-foreground";

  it("positive amounts are emerald, with a dark variant", () => {
    expect(amountClass(100)).toBe(POSITIVE);
    expect(amountClass("50.00")).toBe(POSITIVE);
    expect(amountClass(0.01)).toBe(POSITIVE);
  });

  it("negative amounts are red, with a dark variant", () => {
    expect(amountClass(-0.01)).toBe(NEGATIVE);
    expect(amountClass("-9.99")).toBe(NEGATIVE);
  });

  // Changed in the UI-consistency pass: zero used to fall into the
  // positive branch (`0 >= 0`) and render green. A $0.00 row has no
  // activity — painting it as a gain misreads. The Category report
  // had already forked a local helper to get this behaviour; folding
  // it in here let that fork be deleted.
  it("zero is muted, not emerald", () => {
    expect(amountClass(0)).toBe(NEUTRAL);
    expect(amountClass("0.00")).toBe(NEUTRAL);
    expect(amountClass(-0)).toBe(NEUTRAL);
  });

  // Callers pass possibly-absent averages (`total / months` where
  // months can be 0) — returning the neutral tone beats throwing or
  // emitting a colour for a value that isn't there.
  it("nullish and non-finite input is muted", () => {
    expect(amountClass(null)).toBe(NEUTRAL);
    expect(amountClass(undefined)).toBe(NEUTRAL);
    expect(amountClass(NaN)).toBe(NEUTRAL);
    expect(amountClass("not a number")).toBe(NEUTRAL);
  });
});

describe("diffDaysISO", () => {
  it("returns 0 for same-day", () => {
    expect(diffDaysISO("2026-05-26", "2026-05-26")).toBe(0);
  });
  it("a > b → positive difference", () => {
    expect(diffDaysISO("2026-05-26", "2026-05-20")).toBe(6);
  });
  it("a < b → negative difference", () => {
    expect(diffDaysISO("2026-05-20", "2026-05-26")).toBe(-6);
  });
});

describe("toISO", () => {
  it("formats a Date with the local calendar (not UTC)", () => {
    const d = new Date(2026, 0, 5); // Jan 5 2026 local
    expect(toISO(d)).toBe("2026-01-05");
  });
  it("zero-pads month and day", () => {
    expect(toISO(new Date(2026, 8, 9))).toBe("2026-09-09");
  });
});

describe("numFmt", () => {
  it("formats whole numbers with the en-AU comma separator", () => {
    expect(numFmt.format(1234567)).toBe("1,234,567");
    expect(numFmt.format(0)).toBe("0");
  });
});
