import { describe, expect, it } from "vitest";
import {
  amountClass,
  cn,
  diffDaysISO,
  formatAmount,
  formatAUD,
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
  it("zero and positive amounts are emerald", () => {
    expect(amountClass(0)).toBe("text-emerald-600");
    expect(amountClass(100)).toBe("text-emerald-600");
    expect(amountClass("50.00")).toBe("text-emerald-600");
  });
  it("negative amounts are red", () => {
    expect(amountClass(-0.01)).toBe("text-red-500");
    expect(amountClass("-9.99")).toBe("text-red-500");
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
