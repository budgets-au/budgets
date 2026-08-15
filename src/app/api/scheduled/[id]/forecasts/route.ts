import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledForecasts, scheduledTransactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

// Per-occurrence overrides for scheduled transactions. Each row is
// anchored by the schedule's rule-derived `occurrenceDate` and may
// carry an amount shift, a date shift (0.339+), or both. A row with
// neither is meaningless — the POST validator rejects it.

import { isoDateString, numericString } from "@/lib/zod-helpers";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const upsertSchema = z
  .object({
    occurrenceDate: isoDateString,
    // Both fields are optional but at least one must be present
    // (asserted in the refine below). Empty string / null-ish inputs
    // are treated as "clear this override".
    amount: numericString.optional(),
    newDate: isoDateString.optional(),
  })
  .refine(
    (v) => v.amount !== undefined || v.newDate !== undefined,
    { message: "at least one of amount or newDate must be set" },
  );

const deleteSchema = z.object({
  occurrenceDate: isoDateString,
});

// GET /api/scheduled/[id]/forecasts
// Returns all stored forecasts for the schedule, oldest → newest.
export const GET = withAuthAndId(async (id) => {
  const rows = await db
    .select()
    .from(scheduledForecasts)
    .where(eq(scheduledForecasts.scheduledId, id))
    .orderBy(scheduledForecasts.occurrenceDate);
  return NextResponse.json({ forecasts: rows });
});

// POST /api/scheduled/[id]/forecasts
// Upsert an override for one occurrence date. When `amount` is
// provided it's sign-corrected against the schedule's type; when
// `newDate` is provided the projection shifts the occurrence to
// that date. Both fields are independently upserted — passing only
// `amount` keeps whatever `newDate` was stored (and vice-versa).
export const POST = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, upsertSchema);
  if (!parsed.ok) return parsed.response;
  const { occurrenceDate, amount, newDate } = parsed.data;

  // Look up the schedule to enforce sign convention on amount.
  const [schedule] = await db
    .select({ type: scheduledTransactions.type })
    .from(scheduledTransactions)
    .where(eq(scheduledTransactions.id, id))
    .limit(1);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  let signed: string | null = null;
  if (amount !== undefined) {
    const magnitude = Math.abs(parseFloat(amount));
    signed =
      schedule.type === "expense" || schedule.type === "transfer"
        ? `-${magnitude.toFixed(2)}`
        : magnitude.toFixed(2);
  }

  // Build the update set — only touch the columns the caller sent.
  // Missing keys preserve whatever the existing row carried; on a
  // fresh insert missing keys default to NULL from the schema.
  const updateSet: Record<string, unknown> = { updatedAt: new Date() };
  if (amount !== undefined) updateSet.amount = signed;
  if (newDate !== undefined) updateSet.newDate = newDate;

  const [row] = await db
    .insert(scheduledForecasts)
    .values({
      scheduledId: id,
      occurrenceDate,
      amount: signed,
      newDate: newDate ?? null,
    })
    .onConflictDoUpdate({
      target: [scheduledForecasts.scheduledId, scheduledForecasts.occurrenceDate],
      set: updateSet,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
});

// DELETE /api/scheduled/[id]/forecasts
// Body: { occurrenceDate }. Removes the whole override row (both
// amount and date shifts, if either was set).
export const DELETE = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, deleteSchema);
  if (!parsed.ok) return parsed.response;
  const { occurrenceDate } = parsed.data;

  await db
    .delete(scheduledForecasts)
    .where(
      and(
        eq(scheduledForecasts.scheduledId, id),
        eq(scheduledForecasts.occurrenceDate, occurrenceDate),
      ),
    );
  return NextResponse.json({ ok: true });
});
