import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { getUpcomingSchedules } from "@/lib/dashboard/upcoming-schedules";

/** Next-30-days upcoming scheduled-transaction occurrences, skipping
 * any that already have a posted transaction within tolerance. The
 * shape mirrors the original server-rendered dashboard widget so the
 * client component reads the same fields.
 *
 * `?includeBudgets=true` surfaces `kind="budget"` rows too. The
 * widget reflects the per-user `dashboardUpcomingShowBudgets`
 * pref. */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const includeBudgets = searchParams.get("includeBudgets") === "true";
  return NextResponse.json(await getUpcomingSchedules({ includeBudgets }));
});
