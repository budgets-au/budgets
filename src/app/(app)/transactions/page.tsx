import { Suspense } from "react";
import { db } from "@/db";
import { accounts, categories } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { Topbar } from "@/components/layout/topbar";
import { TransactionsView } from "@/components/transactions/transactions-view";
import { ImportTransactionsButton } from "@/components/import/import-transactions-button";

export default async function TransactionsPage() {
  const [allAccounts, allCategories] = await Promise.all([
    db.select({ id: accounts.id, name: accounts.name, color: accounts.color }).from(accounts).where(eq(accounts.isArchived, false)),
    db
      .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
  ]);

  return (
    <div>
      <Topbar title="Transactions" actions={<ImportTransactionsButton />} />
      <div className="p-4 lg:p-6 space-y-4">
        <Suspense fallback={null}>
          <TransactionsView accounts={allAccounts} initialCategories={allCategories} />
        </Suspense>
      </div>
    </div>
  );
}
