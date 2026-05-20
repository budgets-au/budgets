import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, transactions, scheduledTransactions } from "@/db/schema";
import { withAdminAuth } from "@/lib/api/route-guards";

/** A category is "orphan" when it has zero transactions, zero
 * scheduled rows, no child categories, and isn't a system seed.
 * Conservative by design: a parent that still has descendants stays
 * even if all descendants are unused — the user can rerun the
 * cleanup after one pass and the now-childless parent will be
 * eligible. */
async function findOrphans(): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
  const allCats = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      isSystem: categories.isSystem,
    })
    .from(categories);

  const txnRefs = await db
    .select({ categoryId: transactions.categoryId })
    .from(transactions);
  const withTxn = new Set(
    txnRefs.map((r) => r.categoryId).filter((id): id is string => !!id),
  );

  const schedRefs = await db
    .select({ categoryId: scheduledTransactions.categoryId })
    .from(scheduledTransactions);
  const withSched = new Set(
    schedRefs.map((r) => r.categoryId).filter((id): id is string => !!id),
  );

  const childParents = new Set(
    allCats.map((c) => c.parentId).filter((p): p is string => !!p),
  );

  return allCats
    .filter(
      (c) =>
        !c.isSystem &&
        !withTxn.has(c.id) &&
        !withSched.has(c.id) &&
        !childParents.has(c.id),
    )
    .map((c) => ({ id: c.id, name: c.name, parentId: c.parentId }));
}

export const GET = withAdminAuth(async () => {
  const orphans = await findOrphans();
  return NextResponse.json({ orphans, count: orphans.length });
});

export const POST = withAdminAuth(async () => {
  // Re-derive the list at delete time rather than trusting client IDs —
  // a client could otherwise pass in an in-use category.
  const orphans = await findOrphans();
  const ids = orphans.map((o) => o.id);
  if (ids.length === 0) return NextResponse.json({ ok: true, removed: 0 });
  for (const id of ids) {
    await db.delete(categories).where(eq(categories.id, id));
  }
  return NextResponse.json({ ok: true, removed: ids.length });
});
