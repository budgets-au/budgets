import { NextResponse } from "next/server";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { and, isNotNull, ne, eq } from "drizzle-orm";
import { withAuthAndId } from "@/lib/api/route-guards";
import {
  computeNeighboursAndRanges,
  deriveMatchPayee,
  loadTokenFreq,
  suggestCategoryByHistory,
  type TrigramNeighbour,
  type TrigramCategoryRange,
} from "@/lib/categorize";

export interface NeighboursResponse {
  /** Trigram-suggested category for the row at the moment of the
   *  request. Useful diagnostic when the row's CURRENT categoryId
   *  differs — the operator can see what the suggester would
   *  pick if the row were imported today. */
  suggestion: {
    categoryId: string;
    categoryName: string | null;
    score: number;
    support: number;
  } | null;
  neighbours: TrigramNeighbour[];
  categoryRanges: TrigramCategoryRange[];
}

/** GET /api/transactions/[id]/neighbours — compute the trigram
 *  neighbours + per-category amount ranges for an existing
 *  transaction, on demand. Fetched lazily by the transactions
 *  list's expand panel (`<NeighboursPanelForTransaction>`) so the
 *  list view stays fast — no work happens until the operator
 *  expands a row. Mirrors the diagnostic block the CSV-import
 *  expand panel already shows on the import side. */
export const GET = withAuthAndId(async (id) => {
  const [row] = await db
    .select({
      id: transactions.id,
      normalizedPayee: transactions.normalizedPayee,
      amount: transactions.amount,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(eq(transactions.id, id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const empty: NeighboursResponse = {
    suggestion: null,
    neighbours: [],
    categoryRanges: [],
  };

  const normalized = row.normalizedPayee ?? "";
  const amount = parseFloat(row.amount);
  if (!normalized || normalized.length < 3 || !Number.isFinite(amount)) {
    return NextResponse.json(empty);
  }

  const tokenFreq = await loadTokenFreq();
  const queryMatch = deriveMatchPayee(normalized, tokenFreq) ?? "";
  if (!queryMatch) {
    return NextResponse.json(empty);
  }

  // Pool of categorised, payee-tagged rows EXCLUDING the queried
  // row itself — otherwise the row would show up as its own
  // nearest neighbour at similarity 1.0 and clutter the panel.
  const pool = await db
    .select({
      categoryId: transactions.categoryId,
      matchPayee: transactions.matchPayee,
      normalizedPayee: transactions.normalizedPayee,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        isNotNull(transactions.categoryId),
        isNotNull(transactions.matchPayee),
        ne(transactions.id, id),
      ),
    );

  const suggestion = await suggestCategoryByHistory(
    normalized,
    amount,
    tokenFreq,
    pool,
  );

  // Resolve category names for the panel labels. One query gets
  // every category since the table is small (typically < 100
  // rows); cheaper than two roundtrips when the suggestion lands
  // in one category but the per-cat ranges fan out across many.
  const allCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);
  const catName = new Map(allCats.map((c) => [c.id, c.name]));

  const { neighbours, categoryRanges } = computeNeighboursAndRanges(
    queryMatch,
    pool,
    catName,
    suggestion?.categoryId ?? row.categoryId,
  );

  const response: NeighboursResponse = {
    suggestion: suggestion
      ? {
          categoryId: suggestion.categoryId,
          categoryName: catName.get(suggestion.categoryId) ?? null,
          score: suggestion.score,
          support: suggestion.support,
        }
      : null,
    neighbours,
    categoryRanges,
  };
  return NextResponse.json(response);
});
