import { describe, expect, it } from "vitest";
import { groupAccounts } from "./group-accounts";
import type { Account } from "@/db/schema";

/** Minimal Account row factory — only the fields `groupAccounts`
 *  actually reads. The full schema carries createdAt/updatedAt/etc.
 *  that are irrelevant to grouping. */
function acct(
  partial: Pick<Account, "id" | "type" | "currentBalance"> &
    Partial<Account>,
): Account {
  return {
    name: partial.id,
    institution: null,
    accountNumberLast4: null,
    currency: "AUD",
    startingBalance: "0",
    startingDate: null,
    color: "#000",
    isArchived: false,
    isExternal: false,
    isSample: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  } as Account;
}

describe("groupAccounts", () => {
  it("buckets canonical types into Assets / Liabilities and sums each", () => {
    const result = groupAccounts([
      acct({ id: "a", type: "checking", currentBalance: "1000.00" }),
      acct({ id: "b", type: "savings", currentBalance: "2500.50" }),
      acct({ id: "c", type: "cash", currentBalance: "100.00" }),
      acct({ id: "d", type: "credit", currentBalance: "-450.25" }),
      acct({ id: "e", type: "loan", currentBalance: "-200000.00" }),
    ]);
    const assets = result.groups.find((g) => g.key === "assets")!;
    const liab = result.groups.find((g) => g.key === "liabilities")!;
    expect(assets.accounts.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(assets.subtotal).toBeCloseTo(3600.5, 2);
    expect(liab.accounts.map((a) => a.id)).toEqual(["d", "e"]);
    expect(liab.subtotal).toBeCloseTo(-200450.25, 2);
    expect(result.other).toBeNull();
    expect(result.net).toBeCloseTo(-196849.75, 2);
  });

  it("includes investment + super in Assets", () => {
    const result = groupAccounts([
      acct({ id: "i", type: "investment", currentBalance: "12000" }),
      acct({ id: "s", type: "super", currentBalance: "85000" }),
    ]);
    const assets = result.groups.find((g) => g.key === "assets")!;
    expect(assets.accounts.map((a) => a.id)).toEqual(["i", "s"]);
    expect(assets.subtotal).toBeCloseTo(97000, 2);
  });

  it("routes unfamiliar types into the Other bucket so they stay visible", () => {
    const result = groupAccounts([
      acct({ id: "a", type: "checking", currentBalance: "100" }),
      acct({ id: "x", type: "offset", currentBalance: "50000" }),
    ]);
    expect(result.other).not.toBeNull();
    expect(result.other!.accounts.map((a) => a.id)).toEqual(["x"]);
    expect(result.other!.subtotal).toBeCloseTo(50000, 2);
    expect(result.net).toBeCloseTo(50100, 2);
  });

  it("returns empty groups + zero subtotals when no accounts", () => {
    const result = groupAccounts([]);
    expect(result.groups.every((g) => g.accounts.length === 0)).toBe(true);
    expect(result.groups.every((g) => g.subtotal === 0)).toBe(true);
    expect(result.other).toBeNull();
    expect(result.net).toBe(0);
  });
});
