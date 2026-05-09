import { db } from "@/db";
import { scheduledTransactions, accounts, categories } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { ScheduledDetail } from "@/components/scheduled/scheduled-detail";

const destAcct = alias(accounts, "dest_acct");

export default async function ScheduledDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [[row], allAccounts, allCategories] = await Promise.all([
    db
      .select({
        id: scheduledTransactions.id,
        payee: scheduledTransactions.payee,
        description: scheduledTransactions.description,
        amount: scheduledTransactions.amount,
        amountMin: scheduledTransactions.amountMin,
        kind: scheduledTransactions.kind,
        type: scheduledTransactions.type,
        frequency: scheduledTransactions.frequency,
        interval: scheduledTransactions.interval,
        startDate: scheduledTransactions.startDate,
        endDate: scheduledTransactions.endDate,
        isActive: scheduledTransactions.isActive,
        dayOfMonth: scheduledTransactions.dayOfMonth,
        accountId: scheduledTransactions.accountId,
        accountName: accounts.name,
        categoryId: scheduledTransactions.categoryId,
        categoryName: categories.name,
        transferToAccountId: scheduledTransactions.transferToAccountId,
        transferToAccountName: destAcct.name,
      })
      .from(scheduledTransactions)
      .leftJoin(accounts, eq(scheduledTransactions.accountId, accounts.id))
      .leftJoin(categories, eq(scheduledTransactions.categoryId, categories.id))
      .leftJoin(destAcct, eq(scheduledTransactions.transferToAccountId, destAcct.id))
      .where(eq(scheduledTransactions.id, id))
      .limit(1),
    db.select().from(accounts).orderBy(asc(accounts.name)),
    db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name)),
  ]);

  if (!row) notFound();

  return (
    <div>
      <Topbar title="Scheduled Transaction" />
      <div className="p-4 lg:p-6 max-w-lg">
        <ScheduledDetail row={row} allAccounts={allAccounts} allCategories={allCategories} />
      </div>
    </div>
  );
}
