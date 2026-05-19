import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { backfillOrphanTransfers } from "@/lib/backfill-orphan-transfers";

/**
 * Operator-triggered transfer-pair backfill — the "Re-run transfer
 * backfill" affordance on Settings → Maintenance.
 *
 * The original backfill auto-runs on first unlock and gates itself on
 * `app_settings.transfer_backfill_done` so it doesn't fire again on
 * future restores. This endpoint clears that flag, runs
 * `backfillOrphanTransfers()` once, then leaves the flag set
 * afterwards. Use when manually deleted synthetic stubs need to be
 * regenerated, or when the operator restored a DB whose flag was
 * stale relative to the current pair_id state.
 *
 * Admin-only — it mints rows and touches every transaction.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json(
      { error: "Admin role required" },
      { status: 403 },
    );
  }

  // Reset the flag first so backfillOrphanTransfers (which the runner
  // gates on the flag) doesn't silently no-op. The function itself
  // doesn't read the flag — the gating lives in db/index.ts — but we
  // reset it here so the next cold start treats the run as fresh.
  await db
    .update(appSettings)
    .set({ transferBackfillDone: false, updatedAt: new Date() })
    .where(sql`${appSettings.id} = 1`);

  const { paired } = backfillOrphanTransfers();

  // Re-set the flag so the next unlock doesn't trigger another pass.
  await db
    .update(appSettings)
    .set({ transferBackfillDone: true, updatedAt: new Date() })
    .where(sql`${appSettings.id} = 1`);

  return NextResponse.json({ paired });
}
