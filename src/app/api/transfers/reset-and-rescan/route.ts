import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { pairTransfersInWindow } from "@/lib/transfer-match";

/**
 * Destructive maintenance op for transfer pairs:
 *
 *   1. Delete every row with `is_synthetic = true`.
 *      The FK's `ON DELETE SET NULL` on `transfer_pair_id` clears each
 *      surviving partner's pointer automatically — they revert to
 *      orphan state (`transfer_pair_id IS NULL`).
 *   2. Run `pairTransfersInWindow({})` over the whole DB so any orphan
 *      whose real counterpart exists in another tracked account gets
 *      auto-paired the same way fresh imports do.
 *
 * Rationale: the 0.137.0 backfill mints synthetic counterparts in the
 * "External" account for every orphan transfer it finds, which is the
 * right default but is wrong when the operator knows the real
 * counterpart lives in a tracked account. This route is the user-
 * triggered "scrub the placeholders and try again" operation. After
 * it runs, any remaining orphans are confirmed-no-tracked-counterpart
 * rows and can be left alone, manually linked via the dialog, or
 * re-backfilled by clearing `app_settings.transfer_backfill_done`.
 *
 * Returns counts for the toast in the UI.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deleted = await db
    .delete(transactions)
    .where(eq(transactions.isSynthetic, true))
    .returning({ id: transactions.id });

  const matchResult = await pairTransfersInWindow({});

  return NextResponse.json({
    syntheticsDeleted: deleted.length,
    paired: matchResult.paired,
    suggested: matchResult.suggested,
  });
}
