import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTransactions } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { isoDateString, numericString } from "@/lib/zod-helpers";
import { withAuth } from "@/lib/api/route-guards";
import { badRequest, parseJsonBody } from "@/lib/api/parse-body";

const createSchema = z.object({
  kind: z.enum(["schedule", "budget"]).default("schedule"),
  accountId: z.string().uuid().nullable().optional(),
  payee: z.string().optional(),
  description: z.string().optional(),
  amount: numericString,
  amountMin: numericString.optional().nullable(),
  type: z.enum(["income", "expense", "transfer"]),
  categoryId: z.string().uuid().optional().nullable(),
  transferToAccountId: z.string().uuid().optional().nullable(),
  frequency: z.enum(["once", "daily", "weekly", "fortnightly", "monthly", "quarterly", "yearly"]),
  interval: z.number().int().positive().default(1),
  startDate: isoDateString,
  endDate: isoDateString.optional().nullable(),
  dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  // Add to an existing schedule group (e.g. another phone bill in the
  // "Mobiles" group). Omit for a brand-new single-payee schedule — the DB
  // default generates a fresh lineage_id.
  lineageId: z.string().uuid().optional(),
});

/** Strip matcher-only fields when the row represents a budget — the matcher,
 * lineage UI, transfer-pair logic and range-amount band don't apply, so we
 * never let those columns carry stale values. */
function normaliseForKind<T extends {
  kind?: "schedule" | "budget";
  type?: "income" | "expense" | "transfer";
  amountMin?: string | null;
  transferToAccountId?: string | null;
  dayOfMonth?: number | null;
  interval?: number;
}>(data: T): T {
  if (data.kind !== "budget") return data;
  return {
    ...data,
    type: "expense",
    amountMin: null,
    transferToAccountId: null,
    dayOfMonth: null,
    interval: 1,
  };
}

export const GET = withAuth(async () => {
  const rows = await db
    .select({
      id: scheduledTransactions.id,
      kind: scheduledTransactions.kind,
      payee: scheduledTransactions.payee,
      description: scheduledTransactions.description,
      notes: scheduledTransactions.notes,
      amount: scheduledTransactions.amount,
      amountMin: scheduledTransactions.amountMin,
      type: scheduledTransactions.type,
      categoryId: scheduledTransactions.categoryId,
      accountId: scheduledTransactions.accountId,
      transferToAccountId: scheduledTransactions.transferToAccountId,
      frequency: scheduledTransactions.frequency,
      interval: scheduledTransactions.interval,
      startDate: scheduledTransactions.startDate,
      endDate: scheduledTransactions.endDate,
      dayOfMonth: scheduledTransactions.dayOfMonth,
      isActive: scheduledTransactions.isActive,
      lineageId: scheduledTransactions.lineageId,
    })
    .from(scheduledTransactions)
    .orderBy(asc(scheduledTransactions.startDate));

  return NextResponse.json(rows);
});

export const POST = withAuth(async (request) => {
  // safeParse-via-helper so zod rejections come back as 400 with
  // the issue tree, not unhandled 500's with empty bodies. The
  // smart monkey's guardrail probes discovered the silent-500
  // path on 2026-05-20 (dayOfMonth=42, amount=non-numeric).
  const parseResult = await parseJsonBody(request, createSchema);
  if (!parseResult.ok) return parseResult.response;
  const parsed = normaliseForKind(parseResult.data);

  // Cross-field invariants the schema can't express without
  // contorting into discriminated-union refinements. Same 400
  // shape as schema errors so the client renders them uniformly.
  if (parsed.kind !== "budget" && !parsed.accountId) {
    return badRequest(
      "accountId is required for non-budget schedules",
      "accountId",
    );
  }
  if (
    parsed.kind !== "budget" &&
    parsed.type === "transfer" &&
    !parsed.transferToAccountId
  ) {
    // Found by the smart-monkey guardrail probes: server used to
    // accept this (returned 201) and create a dangling transfer
    // schedule. The form's submit-disabled guard catches it for
    // human users; this is defence-in-depth for direct API
    // consumers.
    return badRequest(
      "transferToAccountId is required when type=transfer",
      "transferToAccountId",
    );
  }
  const [row] = await db.insert(scheduledTransactions).values(parsed).returning();
  return NextResponse.json(row, { status: 201 });
});
