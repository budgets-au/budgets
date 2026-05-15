import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingSchedules } from "@/lib/dashboard/upcoming-schedules";

/** Next-30-days upcoming scheduled-transaction occurrences, skipping
 * any that already have a posted transaction within tolerance. The
 * shape mirrors the original server-rendered dashboard widget so the
 * client component reads the same fields.
 *
 * `?includeBudgets=true` surfaces `kind="budget"` rows too. The
 * widget reflects the per-user `dashboardUpcomingShowBudgets`
 * pref. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const includeBudgets = searchParams.get("includeBudgets") === "true";
  return NextResponse.json(await getUpcomingSchedules({ includeBudgets }));
}
