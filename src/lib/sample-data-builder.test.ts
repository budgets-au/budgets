import { describe, it, expect } from "vitest";
import { buildSampleData, SAMPLE_DATA_COUNTS } from "@/db/sample-data";
import { DEFAULT_CATEGORIES } from "@/db/default-categories";

/** A category-name → fake-id Map shaped like what the seeder builds
 * from the live categories table. Sufficient for the builder; the
 * actual id values don't matter to the assertions below. */
function fakeCategoryMap(): Map<string, string> {
  return new Map(DEFAULT_CATEGORIES.map((c, i) => [c.name, `cat-${i}`]));
}

describe("buildSampleData", () => {
  const today = new Date("2026-05-09T12:00:00");

  it("returns the documented row counts", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
    });
    expect(out.accounts).toHaveLength(SAMPLE_DATA_COUNTS.accounts);
    expect(out.transactions).toHaveLength(SAMPLE_DATA_COUNTS.transactions);
    expect(out.schedules).toHaveLength(SAMPLE_DATA_COUNTS.schedules);
  });

  it("flags every produced row as isSample = true", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
    });
    for (const a of out.accounts) expect(a.isSample).toBe(true);
    for (const t of out.transactions) expect(t.isSample).toBe(true);
    for (const s of out.schedules) expect(s.isSample).toBe(true);
  });

  it("resolves every transaction's category to a default-category id", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
    });
    const validIds = new Set(
      DEFAULT_CATEGORIES.map((_, i) => `cat-${i}`),
    );
    for (const t of out.transactions) {
      // Allow null (e.g. if a future template references a missing
      // category by mistake) — but assert that any non-null id was
      // resolved against the supplied map. This catches typos like
      // "Groceries " vs "Groceries".
      if (t.categoryId !== null) {
        expect(validIds.has(t.categoryId)).toBe(true);
      } else {
        // No template should produce null here — fail explicitly so
        // the typo gets surfaced.
        expect.fail(`transaction ${t.id} (${t.payee}) has null categoryId`);
      }
    }
  });

  it("places transactions inside the last 60 days", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
    });
    const min = new Date(today);
    min.setDate(min.getDate() - 60);
    for (const t of out.transactions) {
      const d = new Date(t.date + "T00:00:00");
      expect(d.getTime()).toBeLessThanOrEqual(today.getTime());
      expect(d.getTime()).toBeGreaterThanOrEqual(min.getTime());
    }
  });

  it("formats amounts as 2-decimal strings", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
    });
    for (const t of out.transactions) {
      expect(t.amount).toMatch(/^-?\d+\.\d{2}$/);
    }
    for (const s of out.schedules) {
      expect(s.amount).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  it("pairs transfer transactions correctly (both halves cross-reference)", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
    });
    const transfers = out.transactions.filter((t) => t.isTransfer);
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.length % 2).toBe(0);

    // For each transfer row, the row it points at must in turn point
    // back at it — symmetric pairing, no orphans.
    const byId = new Map(transfers.map((t) => [t.id, t]));
    for (const t of transfers) {
      expect(t.transferPairId).not.toBeNull();
      const pair = byId.get(t.transferPairId!);
      expect(pair).toBeDefined();
      expect(pair!.transferPairId).toBe(t.id);
      // Sum of a pair's amounts must net to zero.
      expect(parseFloat(t.amount) + parseFloat(pair!.amount)).toBeCloseTo(0, 2);
      // And both halves of a pair share a date.
      expect(t.date).toBe(pair!.date);
    }
  });

  it("computes currentBalance = startingBalance + sum(amounts)", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
    });
    for (const acc of out.accounts) {
      const sum = out.transactions
        .filter((t) => t.accountId === acc.id)
        .reduce((s, t) => s + parseFloat(t.amount), 0);
      const expected = parseFloat(acc.startingBalance) + sum;
      expect(parseFloat(acc.currentBalance)).toBeCloseTo(expected, 2);
    }
  });

  it("anchors transaction dates relative to the supplied today", () => {
    const dayA = new Date("2026-05-09T12:00:00");
    const dayB = new Date("2026-05-10T12:00:00");
    const a = buildSampleData({
      today: dayA,
      categoryIdsByName: fakeCategoryMap(),
    });
    const b = buildSampleData({
      today: dayB,
      categoryIdsByName: fakeCategoryMap(),
    });
    // Newest transaction (daysAgo=0) tracks `today`.
    const newestA = a.transactions
      .map((t) => t.date)
      .sort()
      .at(-1);
    const newestB = b.transactions
      .map((t) => t.date)
      .sort()
      .at(-1);
    expect(newestA).toBe("2026-05-09");
    expect(newestB).toBe("2026-05-10");
  });

  it("pre-allocated accountIds are honoured (deterministic for tests)", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
      accountIds: { checking: "fixed-checking", savings: "fixed-savings" },
    });
    expect(out.accounts[0].id).toBe("fixed-checking");
    expect(out.accounts[1].id).toBe("fixed-savings");
    // Every transaction should reference one of these two IDs.
    const valid = new Set(["fixed-checking", "fixed-savings"]);
    for (const t of out.transactions) {
      expect(valid.has(t.accountId)).toBe(true);
    }
  });

  it("schedules reference checking account and start in the future", () => {
    const out = buildSampleData({
      today,
      categoryIdsByName: fakeCategoryMap(),
      accountIds: { checking: "checking" },
    });
    for (const s of out.schedules) {
      expect(s.accountId).toBe("checking");
      const start = new Date(s.startDate + "T00:00:00");
      expect(start.getTime()).toBeGreaterThan(today.getTime());
      expect(s.isActive).toBe(true);
      expect(s.kind).toBe("schedule");
    }
  });

  it("missing category names produce null categoryId, not crashes", () => {
    // An empty category map simulates an upgrade path where the
    // categories seed hasn't run yet for some reason. The builder
    // should still return a valid structural payload — the seeder
    // is robust to null categoryId on transactions.
    const out = buildSampleData({
      today,
      categoryIdsByName: new Map(),
    });
    expect(out.transactions.every((t) => t.categoryId === null)).toBe(true);
  });
});
