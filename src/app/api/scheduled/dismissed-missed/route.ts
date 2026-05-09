import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { missedScheduledDismissals } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
}
