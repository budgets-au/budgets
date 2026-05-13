import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUpcomingSchedules } from "@/lib/dashboard/upcoming-schedules";

/** Next-30-days upcoming scheduled-transaction occurrences, skipping
 * any that already have a posted transaction within tolerance. The
 * shape mirrors the original server-rendered dashboard widget so the
 * client component reads the same fields. */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await getUpcomingSchedules());
}
