import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledForecasts, scheduledTransactions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

// Per-occurrence expected-amount overrides for variable bills (utilities, etc.).
// The route is keyed by the schedule id; the body specifies which occurrence
// date the forecast applies to. Setting amount to "" (or omitting via DELETE)
// removes the forecast and falls back to the schedule's standard amount.

import { isoDateString, numericString } from "@/lib/zod-helpers";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const upsertSchema = z.object({
  occurrenceDate: isoDateString,
  amount: numericString,
});

const deleteSchema = z.object({
  occurrenceDate: isoDateString,
});

// GET /api/scheduled/[id]/forecasts
// Returns all stored forecasts for the schedule, oldest → newest.
export const GET = withAuthAndId(async (id, request) => {
  const rows = await db
    .select()
    .from(scheduledForecasts)
    .where(eq(scheduledForecasts.scheduledId, id))
    .orderBy(scheduledForecasts.occurrenceDate);
  return NextResponse.json({ forecasts: rows });
});

// POST /api/scheduled/[id]/forecasts
// Upsert a forecast for one occurrence date. Amount is signed by the schedule's
// type (expense/transfer → negative; income → positive).
export const POST = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, upsertSchema);
  if (!parsed.ok) return parsed.response;
  const { occurrenceDate, amount } = parsed.data;

  // Look up the schedule to enforce sign convention.
  const [schedule] = await db
    .select({ type: scheduledTransactions.type })
    .from(scheduledTransactions)
    .where(eq(scheduledTransactions.id, id))
    .limit(1);
  if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  const magnitude = Math.abs(parseFloat(amount));
  const signed =
    schedule.type === "expense" || schedule.type === "transfer"
      ? `-${magnitude.toFixed(2)}`
      : magnitude.toFixed(2);

  const [row] = await db
    .insert(scheduledForecasts)
    .values({ scheduledId: id, occurrenceDate, amount: signed })
    .onConflictDoUpdate({
      target: [scheduledForecasts.scheduledId, scheduledForecasts.occurrenceDate],
      set: { amount: signed, updatedAt: new Date() },
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
});

// DELETE /api/scheduled/[id]/forecasts
// Body: { occurrenceDate }. Removes a single forecast row.
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
