import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/route-guards";
import { pairTransfersInWindow } from "@/lib/transfer-match";

/** Admin-only because this re-pairs across the whole DB. Other equivalent
 *  household-wide maintenance routes (`/api/transfers/backfill`,
 *  `/api/sample-data/remove`, `/api/maintenance/analyze`, `/api/lock`)
 *  are also admin-gated; this one was accidentally `withAuth`. (Issue
 *  #48.) */
export const POST = withAdminAuth(async () => {
  const result = await pairTransfersInWindow({});
  return NextResponse.json(result);
});
