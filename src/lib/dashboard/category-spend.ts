import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions } from "@/db/schema";
import { categoryDescendantIds } from "@/lib/category-descendants";

export interface CategorySpendResult {
  /** Sum of `amount` for the category over the window. Signed — an
   * expense category sums to a negative number, an income category
   * to positive. Caller can take the magnitude if "spend" is what
   * they want to display. */
  total: number;
  /** Number of transactions that contributed. */
  count: number;
  /** Category name for the title row (null when categoryId resolves
   * to an unknown / deleted category). */
  name: string | null;
}

/** Aggregate total + count for a category over a recent window.
 * `includeChildren` rolls up the category's full descendant subtree,
 * matching the cashflow / reports pattern; pass false to scope
 * strictly to the leaf. */
export async function getCategorySpend(
  categoryId: string,
  days = 30,
  includeChildren = true,
): Promise<CategorySpendResult> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (days - 1) * 86400000)
    .toISOString()
    .slice(0, 10);

  const ids = includeChildren
    ? await categoryDescendantIds(categoryId)
    : [categoryId];

  const conditions = [gte(transactions.date, start)];
  conditions.push(
    ids.length > 1
      ? sql`${transactions.categoryId} IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : eq(transactions.categoryId, ids[0] ?? categoryId),
  );

  const [agg] = await db
    .select({
      total: sql<number>`COALESCE(SUM(CAST(${transactions.amount} AS REAL)), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(transactions)
    .where(and(...conditions));

  const [cat] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);

  return {
    total: Number(agg?.total ?? 0),
    count: Number(agg?.count ?? 0),
    name: cat?.name ?? null,
  };
}
