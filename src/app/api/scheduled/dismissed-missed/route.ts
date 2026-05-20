import { NextResponse } from "next/server";
import { db } from "@/db";
import { missedScheduledDismissals } from "@/db/schema";
import { desc } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";

export const GET = withAuth(async () => {
  const rows = await db
    .select({
      id: missedScheduledDismissals.id,
      scheduledId: missedScheduledDismissals.scheduledId,
      occurrenceDate: missedScheduledDismissals.occurrenceDate,
      note: missedScheduledDismissals.note,
      dismissedAt: missedScheduledDismissals.dismissedAt,
    })
    .from(missedScheduledDismissals)
    .orderBy(desc(missedScheduledDismissals.occurrenceDate));

  return NextResponse.json(rows);
});
