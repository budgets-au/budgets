import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scheduledTransactions } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { isoDateString, numericString } from "@/lib/zod-helpers";

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

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      id: scheduledTransactions.id,
      kind: scheduledTransactions.kind,
      payee: scheduledTransactions.payee,
      description: scheduledTransactions.description,
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
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const parsed = normaliseForKind(createSchema.parse(body));
  if (parsed.kind !== "budget" && !parsed.accountId) {
    return NextResponse.json(
      { error: "accountId is required for non-budget schedules" },
      { status: 400 },
    );
  }
  const [row] = await db.insert(scheduledTransactions).values(parsed).returning();
  return NextResponse.json(row, { status: 201 });
}
