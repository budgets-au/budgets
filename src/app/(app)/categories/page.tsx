import { db } from "@/db";
import { appSettings, categories, transactions } from "@/db/schema";
import { asc, count, eq, sql } from "drizzle-orm";
import { Topbar } from "@/components/layout/topbar";
import { CategoryManager } from "@/components/settings/category-manager";
import type { TaxConfig } from "@/db/schema";

const EMPTY_TAX_CONFIG: TaxConfig = { wfhHoursByFy: {}, categoryRules: {} };

export default async function CategoriesPage() {
  const [allCategories, countRows, sumRows, settings] = await Promise.all([
    db
      .select()
      .from(categories)
      .orderBy(asc(categories.type), asc(categories.sortOrder), asc(categories.name)),
    db
      .select({ categoryId: transactions.categoryId, count: count() })
      .from(transactions)
      .where(
        sql`${transactions.categoryId} IS NOT NULL AND EXISTS (
          SELECT 1 FROM categories c WHERE c.id = ${transactions.categoryId} AND c.transfer_kind != 'internal'
        )`,
      )
      .groupBy(transactions.categoryId),
    db
      .select({
        categoryId: transactions.categoryId,
        sum: sql<number>`SUM(CAST(${transactions.amount} AS REAL))`,
      })
      .from(transactions)
      .where(
        sql`${transactions.categoryId} IS NOT NULL AND EXISTS (
          SELECT 1 FROM categories c WHERE c.id = ${transactions.categoryId} AND c.transfer_kind != 'internal'
        )`,
      )
      .groupBy(transactions.categoryId),
    db
      .select({ taxConfig: appSettings.taxConfig })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1),
  ]);

  const txCounts: Record<string, number> = {};
  for (const row of countRows) {
    if (row.categoryId) txCounts[row.categoryId] = row.count;
  }
  const txAmounts: Record<string, number> = {};
  for (const row of sumRows) {
    if (row.categoryId) txAmounts[row.categoryId] = row.sum;
  }
  const taxConfig: TaxConfig = settings[0]?.taxConfig ?? EMPTY_TAX_CONFIG;

  return (
    <div>
      <Topbar title="Categories" />
      <div className="p-4 lg:p-6 max-w-3xl">
        <CategoryManager
          initialCategories={allCategories}
          txCounts={txCounts}
          txAmounts={txAmounts}
          taxConfig={taxConfig}
        />
      </div>
    </div>
  );
}
