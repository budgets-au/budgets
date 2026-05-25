import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";
import {
  loadTokenFreq,
  normalizePayee,
  suggestCategoryByHistory,
} from "@/lib/categorize";

/** Row shape consumed by `/transactions/categorise` — the "bulk
 *  fix uncategorised" companion to the CSV import flow.
 *
 *  Same suggester (`suggestCategoryByHistory`) the import categorise
 *  step uses, applied to existing DB rows. Lets the operator blow
 *  through long-tail uncategorised rows without uploading a CSV.
 */
export interface UncategorisedRow {
  id: string;
  date: string;
  amount: string;
  payee: string | null;
  normalizedPayee: string | null;
  accountId: string;
  accountName: string;
  /** Suggester output — null when the payee was empty / too short
   *  / had no historical match. UI can pre-fill the picker when set
   *  and dim/blank the row when null. */
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  /** 0..1 — higher = more confident. Used to sort the queue so the
   *  user picks off easy wins first. */
  suggestedScore: number | null;
  /** Number of historical rows backing the suggestion. */
  suggestedSupport: number | null;
}

/** GET /api/transactions/uncategorised-categorise — load every
 *  uncategorised transaction with a category suggestion attached.
 *
 *  Pre-loads the token-frequency map and the trigram candidate pool
 *  ONCE, then scores every uncategorised row in JS — the same
 *  bulk-pattern `/api/import/categorise` uses (#95) to avoid one
 *  full-table scan per row.
 */
export const GET = withAuth(async () => {
  // Fetch uncategorised txns + their account names in one go.
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      payee: transactions.payee,
      normalizedPayee: transactions.normalizedPayee,
      accountId: transactions.accountId,
      accountName: accounts.name,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(isNull(transactions.categoryId))
    .orderBy(asc(transactions.date), asc(transactions.id));

  if (rows.length === 0) {
    return NextResponse.json([] as UncategorisedRow[]);
  }

  // Pre-warm shared inputs — same pattern as the import categorise
  // route's trigram path.
  const tokenFreq = await loadTokenFreq();
  const candidatePool = await db
    .select({
      categoryId: transactions.categoryId,
      matchPayee: transactions.matchPayee,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        isNotNull(transactions.categoryId),
        isNotNull(transactions.matchPayee),
      ),
    );
  // Filter out the nullables so the type matches `SuggestCandidate`
  // — drizzle's `isNotNull` checks runtime, not TS.
  const candidates = candidatePool.filter(
    (c): c is { categoryId: string; matchPayee: string; amount: string } =>
      c.categoryId !== null && c.matchPayee !== null,
  );

  // Resolve category names in one shot so the response carries the
  // friendly label alongside the id.
  const allCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories);
  const catNameById = new Map(allCats.map((c) => [c.id, c.name]));

  // Score each row sequentially — the function itself is in-memory
  // once the candidate pool is preloaded, so a Promise.all here
  // would only add scheduling overhead.
  const out: UncategorisedRow[] = [];
  for (const r of rows) {
    // Trigram works on the normalised form. If a row is missing it
    // (legacy / hand-entered), derive on the fly so we still get a
    // chance at a suggestion.
    const normalized =
      r.normalizedPayee && r.normalizedPayee.length > 0
        ? r.normalizedPayee
        : r.payee
          ? normalizePayee(r.payee)
          : "";
    const amt = parseFloat(r.amount);
    const suggestion =
      normalized.length >= 3 && Number.isFinite(amt)
        ? await suggestCategoryByHistory(normalized, amt, tokenFreq, candidates)
        : null;

    out.push({
      id: r.id,
      date: r.date,
      amount: r.amount,
      payee: r.payee,
      normalizedPayee: r.normalizedPayee,
      accountId: r.accountId,
      accountName: r.accountName ?? "",
      suggestedCategoryId: suggestion?.categoryId ?? null,
      suggestedCategoryName: suggestion
        ? catNameById.get(suggestion.categoryId) ?? null
        : null,
      suggestedScore: suggestion?.score ?? null,
      suggestedSupport: suggestion?.support ?? null,
    });
  }

  // Sort so the highest-confidence suggestions come first — the user
  // picks off the easy wins, then handles the ambiguous tail with
  // their eyes open. Rows with no suggestion sink to the bottom.
  out.sort((a, b) => (b.suggestedScore ?? -1) - (a.suggestedScore ?? -1));

  return NextResponse.json(out);
});
