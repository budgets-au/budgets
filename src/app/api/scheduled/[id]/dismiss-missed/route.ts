import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { missedScheduledDismissals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  occurrenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).default(""),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const data = createSchema.parse(body);

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
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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
}
