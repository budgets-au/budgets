import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduledTransactions, scheduleSuggestionDismissals } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { normalizePayee } from "@/lib/categorize";
import { isoDateString, numericString } from "@/lib/zod-helpers";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const updateSchema = z.object({
  kind: z.enum(["schedule", "budget"]).optional(),
  accountId: z.string().uuid().nullable().optional(),
  payee: z.string().optional(),
  description: z.string().optional(),
  amount: numericString.optional(),
  amountMin: numericString.nullable().optional(),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  transferToAccountId: z.string().uuid().optional().nullable(),
  frequency: z.enum(["once", "daily", "weekly", "fortnightly", "monthly", "quarterly", "yearly"]).optional(),
  interval: z.number().int().positive().optional(),
  startDate: isoDateString.optional(),
  endDate: isoDateString.optional().nullable(),
  dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const PATCH = withAuthAndId(async (id, request) => {
  const parseResult = await parseJsonBody(request, updateSchema);
  if (!parseResult.ok) return parseResult.response;
  const parsed = parseResult.data;
  // When the row is being saved as a budget (either now or already), strip
  // matcher-only fields so they can't carry stale values into the budget
  // semantics.
  const data =
    parsed.kind === "budget"
      ? {
          ...parsed,
          type: "expense" as const,
          amountMin: null,
          transferToAccountId: null,
          dayOfMonth: null,
          interval: 1,
        }
      : parsed;

  const [row] = await db
    .update(scheduledTransactions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(scheduledTransactions.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
});

export const DELETE = withAuthAndId(async (id) => {
  // Capture the schedule's identity before deleting so we can plant a
  // suggestion-dismissal — otherwise the suggestion engine would re-detect the
  // same pattern from the surviving historical transactions and surface it
  // again on the next refresh.
  const [row] = await db
    .delete(scheduledTransactions)
    .where(eq(scheduledTransactions.id, id))
    .returning({
      accountId: scheduledTransactions.accountId,
      transferToAccountId: scheduledTransactions.transferToAccountId,
      payee: scheduledTransactions.payee,
    });

  if (row?.payee) {
    const norm = normalizePayee(row.payee);
    if (norm.length >= 3) {
      // Dismiss on both legs for transfers — the destination side groups
      // separately in the suggestion engine and would otherwise still
      // surface as a candidate. Budget rows may have no account, in which
      // case there's nothing to dismiss.
      const accounts = new Set<string>();
      if (row.accountId) accounts.add(row.accountId);
      if (row.transferToAccountId) accounts.add(row.transferToAccountId);
      for (const accountId of accounts) {
        await db
          .insert(scheduleSuggestionDismissals)
          .values({ accountId, normalizedPayee: norm })
          .onConflictDoUpdate({
            target: [
              scheduleSuggestionDismissals.accountId,
              scheduleSuggestionDismissals.normalizedPayee,
            ],
            set: { dismissedAt: new Date() },
          });
      }
    }
  }

  return NextResponse.json({ ok: true });
});
