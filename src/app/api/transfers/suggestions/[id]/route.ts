import { NextResponse } from "next/server";
import { db } from "@/db";
import { dismissedTransferPairs, transferSuggestions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withAuthAndId } from "@/lib/api/route-guards";

/** Dismiss a suggested transfer pair.
 *
 *  1. Records the (transactionId, candidateId) in
 *     `dismissed_transfer_pairs` so the matcher's next run doesn't
 *     re-discover and re-insert the same suggestion.
 *  2. Deletes the row from `transfer_suggestions` so the UI
 *     refreshes without it.
 *
 *  The sticky-dismissal table is the reason the same pair stopped
 *  coming back every restart — see 0.194.0 changelog. */
export const DELETE = withAuthAndId(async (id) => {
  const [row] = await db
    .select({
      transactionId: transferSuggestions.transactionId,
      candidateId: transferSuggestions.candidateId,
    })
    .from(transferSuggestions)
    .where(eq(transferSuggestions.id, id))
    .limit(1);
  if (row) {
    await db
      .insert(dismissedTransferPairs)
      .values({
        transactionId: row.transactionId,
        candidateId: row.candidateId,
      })
      // The pair may already exist from a prior dismissal that the
      // matcher re-suggested before this release — treat the new
      // dismiss as a no-op on the sticky table.
      .onConflictDoNothing({
        target: [
          dismissedTransferPairs.transactionId,
          dismissedTransferPairs.candidateId,
        ],
      });
  }
  await db.delete(transferSuggestions).where(eq(transferSuggestions.id, id));
  return NextResponse.json({ ok: true });
});
