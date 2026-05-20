import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledForecasts, scheduledTransactions } from "@/db/schema";
import { and, eq, gte, ne } from "drizzle-orm";
import { z } from "zod";
import { isoDateString, numericString } from "@/lib/zod-helpers";
import { withAuthAndId } from "@/lib/api/route-guards";

// POST /api/scheduled/[id]/replace
// Closes the predecessor schedule with an end_date and creates a successor
// inheriting payee/category/account/frequency/etc. but with a new amount and
// effective date. Both rows share the predecessor's lineage_id so the chain
// can be queried as one logical recurring payment with rate changes.
//
// Body:
//   newAmount      (string, required, positive magnitude)
//   effectiveDate  (string, required, "YYYY-MM-DD"; must be > predecessor.startDate)
//   payee          (string, optional; when set, successor uses this value
//                   instead of inheriting the predecessor's payee — useful
//                   when a service rebrands at the same time as a price change)

const schema = z.object({
  newAmount: numericString,
  effectiveDate: isoDateString,
  payee: z.string().optional(),
});

function isoMinusOneDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export const POST = withAuthAndId(async (id, request) => {
  const body = await request.json();
  const { newAmount, effectiveDate, payee } = schema.parse(body);

  const [predecessor] = await db
    .select()
    .from(scheduledTransactions)
    .where(eq(scheduledTransactions.id, id))
    .limit(1);
  if (!predecessor) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // effectiveDate must be strictly after the predecessor's startDate; otherwise
  // we'd set endDate <= startDate, which is meaningless for a recurrence.
  if (effectiveDate <= predecessor.startDate) {
    return NextResponse.json(
      { error: "Effective date must be after the predecessor's start date" },
      { status: 400 },
    );
  }
  // And after any existing endDate on a previously-closed predecessor —
  // otherwise replacing a superseded row would silently overwrite its
  // historical end_date and reopen the closed window.
  if (predecessor.endDate && effectiveDate <= predecessor.endDate) {
    return NextResponse.json(
      { error: "Effective date must be after the predecessor's end date" },
      { status: 400 },
    );
  }

  // Preserve the original sign convention. Expense/transfer schedules store
  // negative amounts; income store positive. The user provides a positive
  // magnitude in the dialog.
  const magnitude = Math.abs(parseFloat(newAmount));
  const signedAmount =
    predecessor.type === "expense" || predecessor.type === "transfer"
      ? `-${magnitude.toFixed(2)}`
      : magnitude.toFixed(2);

  const oldEndDate = isoMinusOneDay(effectiveDate);
  const successorPayee = payee?.trim() ? payee.trim() : predecessor.payee;

  // Wrap the four writes in a single transaction so a mid-flow failure can't
  // leave the lineage with a deactivated predecessor and no successor.
  const successor = await db.transaction(async (tx) => {
    await tx
      .update(scheduledTransactions)
      .set({
        endDate: oldEndDate,
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(scheduledTransactions.id, id));

    const [inserted] = await tx
      .insert(scheduledTransactions)
      .values({
        accountId: predecessor.accountId,
        payee: successorPayee,
        description: predecessor.description,
        amount: signedAmount,
        type: predecessor.type,
        categoryId: predecessor.categoryId,
        transferToAccountId: predecessor.transferToAccountId,
        frequency: predecessor.frequency,
        interval: predecessor.interval,
        startDate: effectiveDate,
        endDate: null,
        dayOfMonth: predecessor.dayOfMonth,
        isActive: true,
        lineageId: predecessor.lineageId,
      })
      .returning();

    // Move any user-entered forecasts for dates at-or-after the new effective
    // date from the predecessor to the successor, so seasonal overrides survive
    // a rate change. Two-step to avoid a unique-key collision if the successor
    // somehow already had a forecast for the same date:
    //   1. Drop any successor rows that would collide.
    //   2. UPDATE predecessor's forecasts to point at the successor.
    await tx
      .delete(scheduledForecasts)
      .where(and(
        eq(scheduledForecasts.scheduledId, inserted.id),
        gte(scheduledForecasts.occurrenceDate, effectiveDate),
      ));
    await tx
      .update(scheduledForecasts)
      .set({ scheduledId: inserted.id, updatedAt: new Date() })
      .where(and(
        eq(scheduledForecasts.scheduledId, id),
        gte(scheduledForecasts.occurrenceDate, effectiveDate),
        // Defensive: never re-point onto the predecessor itself if id == successor.id.
        ne(scheduledForecasts.scheduledId, inserted.id),
      ));

    return inserted;
  });

  return NextResponse.json({ predecessorId: id, successor });
});
