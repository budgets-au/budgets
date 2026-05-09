/**
 * Sign convention for the by-category report total. The SQL in
 * `/api/reports/route.ts` uses a CASE expression that mirrors this
 * function so an expense category's total reflects net spent
 * (refunds reduce) and an income category reflects net earned
 * (reversals reduce). Without it, `SUM(ABS(amount))` would inflate
 * a refunded purchase to twice its real cost.
 *
 * The helper is the canonical formula; the route's SQL is the
 * actual hot path. Keep them in sync — if the convention changes
 * here, update the SQL CASE expression in the same commit.
 */
export type CategoryType = "income" | "expense" | string | null;

/** Sign multiplier for a category's transaction amounts. Income
 * categories sum as-is; everything else (expense, transfer,
 * uncategorised) treats negative amounts as positive "spent".
 *
 * Exposed so the SQL builder and any client-side rollup share the
 * same one-place definition. */
export function categorySignMultiplier(type: CategoryType): 1 | -1 {
  return type === "income" ? 1 : -1;
}

/** Net total for a single category given its raw transactions.
 * Positive result means activity went in the expected direction
 * (income earned, or expense spent); negative means refunds/reversals
 * dominate. */
export function categoryNetTotal(
  rows: { amount: number }[],
  type: CategoryType,
): number {
  const sign = categorySignMultiplier(type);
  return rows.reduce((acc, r) => acc + sign * r.amount, 0);
}
