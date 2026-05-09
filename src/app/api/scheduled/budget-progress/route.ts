import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { categories, scheduledTransactions, transactions } from "@/db/schema";
import { eq, and, gte, inArray, lte, sql } from "drizzle-orm";
import { currentBudgetPeriod } from "@/lib/budget-period";
import {
  buildChildrenByParent,
  descendantIdsFromMap,
} from "@/lib/category-descendants";

interface ProgressRow {
  scheduledId: string;
  periodFrom: string;
  periodTo: string;
  spent: string;
  cap: string;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const budgets = await db
    .select()
    .from(scheduledTransactions)
    .where(
      and(
        eq(scheduledTransactions.kind, "budget"),
        eq(scheduledTransactions.isActive, true),
      ),
    );

  // Build the parent → children map ONCE up front so each budget's
  // descendant walk is a pure JS lookup. Previously each budget hit the
  // full categories table — at 20 budgets × 200 categories that was
  // 20 redundant table scans per progress poll.
  const categoryRows = await db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories);
  const childrenByParent = buildChildrenByParent(categoryRows);

  const today = new Date();

  // Per-budget aggregate: txns inside the current period whose category is in
  // the budget's category subtree (recursive CTE) and whose account matches
  // if the budget has one set. Sum amounts in the budget's direction — for
  // an expense budget (negative cap), a +76 refund must REDUCE spent, not
  // inflate it. Multiply the raw sum by the cap's sign so the result is
  // always in "magnitude spent" units regardless of how the budget was
  // entered. Run all budget queries in parallel — each one is independent
  // and they don't share state, so a 10-budget user goes from 10 sequential
  // round-trips to one wave.
  const out = await Promise.all(
    budgets.map(async (b): Promise<ProgressRow> => {
      if (!b.categoryId) {
        return {
          scheduledId: b.id,
          periodFrom: "",
          periodTo: "",
          spent: "0.00",
          cap: b.amount,
        };
      }
      const period = currentBudgetPeriod(b.startDate, b.frequency, today);
      const descendantIds = descendantIdsFromMap(b.categoryId, childrenByParent);
      const conditions = [
        gte(transactions.date, period.from),
        lte(transactions.date, period.to),
        inArray(transactions.categoryId, descendantIds),
      ];
      if (b.accountId) {
        conditions.push(eq(transactions.accountId, b.accountId));
      }
      const [row] = await db
        .select({
          rawSum: sql<string>`CAST(COALESCE(SUM(CAST(${transactions.amount} AS REAL)), 0) AS TEXT)`,
        })
        .from(transactions)
        .where(and(...conditions));

      const sign = parseFloat(b.amount) >= 0 ? 1 : -1;
      const spent = (parseFloat(row?.rawSum ?? "0") * sign).toFixed(2);

      return {
        scheduledId: b.id,
        periodFrom: period.from,
        periodTo: period.to,
        spent,
        cap: b.amount,
      };
    }),
  );

  return NextResponse.json(out);
}
