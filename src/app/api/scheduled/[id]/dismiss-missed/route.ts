import { NextResponse } from "next/server";
import { db } from "@/db";
import { missedScheduledDismissals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const createSchema = z.object({
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).default(""),
});

export const POST = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // Idempotent: if a dismissal already exists for this (schedule, date) the
  // user is amending the note rather than creating a duplicate.
  const [row] = await db
    .insert(missedScheduledDismissals)
    .values({ scheduledId: id, occurrenceDate: data.occurrenceDate, note: data.note })
    .onConflictDoUpdate({
      target: [missedScheduledDismissals.scheduledId, missedScheduledDismissals.occurrenceDate],
      set: { note: data.note, dismissedAt: new Date() },
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
});

export const DELETE = withAuthAndId(async (id, request) => {
  const { searchParams } = new URL(request.url);
  const occurrenceDate = searchParams.get("occurrenceDate");
  if (!occurrenceDate || !/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDate)) {
    return NextResponse.json({ error: "occurrenceDate required (YYYY-MM-DD)" }, { status: 400 });
  }

  await db
    .delete(missedScheduledDismissals)
    .where(
      and(
        eq(missedScheduledDismissals.scheduledId, id),
        eq(missedScheduledDismissals.occurrenceDate, occurrenceDate),
      ),
    );

  return NextResponse.json({ ok: true });
});
