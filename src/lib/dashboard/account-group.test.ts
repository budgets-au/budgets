import { describe, expect, it } from "vitest";
import {
  computeAccountGroup,
  flipSign,
  parseAccountGroupConfig,
  toggleMember,
} from "./account-group";

const accounts = [
  { id: "sav", name: "Savings", currentBalance: "10000.10" },
  { id: "cc", name: "Credit card", currentBalance: "-2500.05" },
  { id: "loan", name: "Car loan", currentBalance: "-7000" },
  { id: "old", name: "Old account", currentBalance: "50", isArchived: true },
];

describe("parseAccountGroupConfig", () => {
  it("returns an empty group for missing or malformed config", () => {
    expect(parseAccountGroupConfig(undefined)).toEqual({ title: "", members: [] });
    expect(parseAccountGroupConfig({ members: "nope", title: 3 })).toEqual({ title: "", members: [] });
  });

  it("keeps valid members, drops junk and duplicates, defaults sign to +1", () => {
    const cfg = parseAccountGroupConfig({
      title: "Savings minus debts",
      members: [{ id: "sav" }, { id: "cc", sign: -1 }, { id: "sav", sign: -1 }, { id: 5 }, null, { id: "loan", sign: 7 }],
    });
    expect(cfg.title).toBe("Savings minus debts");
    expect(cfg.members).toEqual([
      { id: "sav", sign: 1 },
      { id: "cc", sign: -1 },
      { id: "loan", sign: 1 },
    ]);
  });
});

describe("computeAccountGroup", () => {
  it("savings minus liabilities is a plain sum, since debts are stored negative", () => {
    const r = computeAccountGroup(accounts, [
      { id: "sav", sign: 1 },
      { id: "cc", sign: 1 },
      { id: "loan", sign: 1 },
    ]);
    expect(r.total).toBe(500.05);
    expect(r.rows.map((x) => x.contribution)).toEqual([10000.1, -2500.05, -7000]);
  });

  it("subtract flips an account's contribution", () => {
    const r = computeAccountGroup(accounts, [
      { id: "sav", sign: 1 },
      { id: "old", sign: -1 },
    ]);
    expect(r.total).toBe(9950.1);
    expect(r.rows[1]).toMatchObject({ contribution: -50, isArchived: true });
  });

  it("counts selected accounts that no longer exist instead of failing", () => {
    const r = computeAccountGroup(accounts, [
      { id: "sav", sign: 1 },
      { id: "deleted", sign: 1 },
    ]);
    expect(r).toMatchObject({ total: 10000.1, missing: 1 });
  });

  it("sums in cents without float drift", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, name: "x", currentBalance: "0.10" }));
    const r = computeAccountGroup(many, many.map((a) => ({ id: a.id, sign: 1 as const })));
    expect(r.total).toBe(1);
  });
});

describe("member editing", () => {
  it("toggles membership and flips sign", () => {
    let m = toggleMember([], "sav");
    m = toggleMember(m, "cc");
    expect(m).toEqual([{ id: "sav", sign: 1 }, { id: "cc", sign: 1 }]);
    m = flipSign(m, "cc");
    expect(m[1].sign).toBe(-1);
    m = toggleMember(m, "sav");
    expect(m).toEqual([{ id: "cc", sign: -1 }]);
  });
});
