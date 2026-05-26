import { describe, expect, it } from "vitest";
import {
  computeNeighboursAndRanges,
  type SuggestCandidate,
} from "./categorize";

/** Fixture pool: three categorised rows under two categories. The
 *  "Groceries" rows share the COLES STORE merchant; the "Bills"
 *  row is a power bill with a clearly different payee. */
const POOL: SuggestCandidate[] = [
  {
    categoryId: "cat-groceries",
    matchPayee: "COLES STORE NUNAWADING",
    normalizedPayee: "COLES STORE NUNAWADING",
    amount: "-42.50",
  },
  {
    categoryId: "cat-groceries",
    matchPayee: "COLES STORE NUNAWADING",
    normalizedPayee: "COLES STORE NUNAWADING",
    amount: "-85.00",
  },
  {
    categoryId: "cat-bills",
    matchPayee: "POWERSHOP ELEC AU",
    normalizedPayee: "POWERSHOP ELEC AU",
    amount: "-220.00",
  },
];

const CAT_NAMES = new Map([
  ["cat-groceries", "Food / Groceries"],
  ["cat-bills", "Bills / Electricity"],
]);

describe("computeNeighboursAndRanges", () => {
  it("returns top-K neighbours sorted by similarity desc", () => {
    const { neighbours } = computeNeighboursAndRanges(
      "COLES STORE NUNAWADING",
      POOL,
      CAT_NAMES,
      "cat-groceries",
    );
    expect(neighbours.length).toBeGreaterThan(0);
    // First neighbour should be the strongest match — the Coles row.
    expect(neighbours[0].normalizedPayee).toBe("COLES STORE NUNAWADING");
    expect(neighbours[0].similarity).toBeCloseTo(1, 2);
    expect(neighbours[0].categoryName).toBe("Food / Groceries");
    // Similarities are monotonically decreasing.
    for (let i = 1; i < neighbours.length; i++) {
      expect(neighbours[i].similarity).toBeLessThanOrEqual(
        neighbours[i - 1].similarity,
      );
    }
  });

  it("flags the picked category in the per-category ranges", () => {
    const { categoryRanges } = computeNeighboursAndRanges(
      "COLES STORE NUNAWADING",
      POOL,
      CAT_NAMES,
      "cat-groceries",
    );
    const picked = categoryRanges.find((r) => r.isPicked);
    expect(picked).toBeDefined();
    expect(picked!.categoryId).toBe("cat-groceries");
    expect(picked!.support).toBe(2);
    // ABS magnitudes — expense amounts arrive negative.
    expect(picked!.minAmount).toBe(42.5);
    expect(picked!.maxAmount).toBe(85);
  });

  it("returns empty result when queryMatch is empty", () => {
    const { neighbours, categoryRanges } = computeNeighboursAndRanges(
      "",
      POOL,
      CAT_NAMES,
      "cat-groceries",
    );
    expect(neighbours).toEqual([]);
    expect(categoryRanges).toEqual([]);
  });

  it("drops candidates below the 0.4 similarity floor", () => {
    const { neighbours } = computeNeighboursAndRanges(
      "TOTALLY UNRELATED MERCHANT XYZ",
      POOL,
      CAT_NAMES,
      null,
    );
    // None of the three pool rows should clear the floor against
    // an unrelated query.
    expect(neighbours.length).toBe(0);
  });

  it("falls back to '—' label when the categoryId isn't in the names map", () => {
    const POOL_UNKNOWN: SuggestCandidate[] = [
      {
        categoryId: "cat-mystery",
        matchPayee: "COLES STORE NUNAWADING",
        normalizedPayee: "COLES STORE NUNAWADING",
        amount: "-50",
      },
    ];
    const { neighbours, categoryRanges } = computeNeighboursAndRanges(
      "COLES STORE NUNAWADING",
      POOL_UNKNOWN,
      new Map(), // empty
      null,
    );
    expect(neighbours[0].categoryName).toBeNull();
    expect(categoryRanges[0].categoryName).toBeNull();
  });
});
