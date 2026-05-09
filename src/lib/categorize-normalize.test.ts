import { describe, it, expect } from "vitest";
import { normalizePayee } from "./categorize";

describe("normalizePayee", () => {
  it("uppercases and trims", () => {
    expect(normalizePayee("  woolworths  ")).toBe("WOOLWORTHS");
  });

  it("strips known bank-prefix lead-ins", () => {
    // BANK_PREFIXES whitelists specific bank-emitted prefixes like
    // "EFTPOS DEBIT" / "DEPOSIT ONLINE" — bare "EFTPOS" stays (it appears
    // mid-string for legitimate bank-card payees).
    expect(normalizePayee("EFTPOS DEBIT Coles")).toBe("COLES");
    expect(normalizePayee("DEPOSIT ONLINE Salary")).toBe("SALARY");
    expect(normalizePayee("DEPOSIT-OSKO PayID Bob")).toBe("PAYID BOB");
  });

  it("strips foreign-transaction-fee tail", () => {
    expect(
      normalizePayee("ALIPAY USD 11.00 INCL. FOREIGN TRANSACTION FEE AUD $0.46"),
    ).toBe("ALIPAY");
  });

  it("strips long-form dates", () => {
    expect(normalizePayee("Optus 17-FEBRUARY-2026")).toBe("OPTUS");
    expect(normalizePayee("Telstra 17-Feb-2026")).toBe("TELSTRA");
  });

  it("strips short-form dates", () => {
    expect(normalizePayee("Origin 11 APR 2026")).toBe("ORIGIN");
    expect(normalizePayee("Origin 11 APR")).toBe("ORIGIN");
  });

  it("strips slash dates", () => {
    expect(normalizePayee("Energex 26/04")).toBe("ENERGEX");
    expect(normalizePayee("Energex 26/04/24")).toBe("ENERGEX");
  });

  it("strips long numeric reference codes", () => {
    expect(normalizePayee("Paypal 1234567890")).toBe("PAYPAL");
  });

  it("preserves alphanumeric policy numbers (no longer stripped)", () => {
    // AAMI policy numbers were being stripped before — that bug merged
    // distinct policies under one normalised key. Make sure we keep them.
    expect(normalizePayee("AAMI INSURANCE HPA029263300")).toBe(
      "AAMI INSURANCE HPA029263300",
    );
  });

  it("strips trailing country codes", () => {
    expect(normalizePayee("Apple AUS")).toBe("APPLE");
    expect(normalizePayee("Stripe USA")).toBe("STRIPE");
    expect(normalizePayee("Vodafone NZL")).toBe("VODAFONE");
  });

  it("decodes & entity", () => {
    expect(normalizePayee("Bunnings &amp; Co")).toBe("BUNNINGS & CO");
  });

  it("collapses runs of whitespace", () => {
    expect(normalizePayee("Coles    Mt   Pleasant")).toBe("COLES MT PLEASANT");
  });

  it("strips trailing CSV-truncation backslashes", () => {
    expect(normalizePayee("Coles\\\\")).toBe("COLES");
  });

  it("strips trailing hyphens / spaces left over from other strips", () => {
    // After stripping the date "26/04" the original "Coles - 26/04" leaves
    // "Coles - " — both the trailing hyphen and the space need to go.
    expect(normalizePayee("Coles - 26/04")).toBe("COLES");
  });

  it("returns empty string for input that's entirely strip-able", () => {
    expect(normalizePayee("17-FEB-2026")).toBe("");
    expect(normalizePayee("123456789")).toBe("");
  });
});
