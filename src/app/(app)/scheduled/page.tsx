import { db } from "@/db";
import { scheduledTransactions, categories, accounts, scheduledForecasts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { Topbar } from "@/components/layout/topbar";
import { ScheduledListView } from "@/components/scheduled/scheduled-list-view";
import { ScheduleSuggestionsPanel } from "@/components/scheduled/schedule-suggestions-panel";
import { NewScheduledButton } from "@/components/scheduled/new-scheduled-dialog";

export default async function ScheduledPage() {
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
      accountName: accounts.name,
      accountColor: accounts.color,
      categoryName: categories.name,
    })
    .from(scheduledTransactions)
    .leftJoin(accounts, eq(scheduledTransactions.accountId, accounts.id))
    .leftJoin(categories, eq(scheduledTransactions.categoryId, categories.id))
    .orderBy(scheduledTransactions.startDate);

  const [accountList, categoryList, forecastList] = await Promise.all([
    db.select({
      id: accounts.id,
      name: accounts.name,
      color: accounts.color,
      type: accounts.type,
      isExternal: accounts.isExternal,
    })
      .from(accounts)
      .orderBy(asc(accounts.name)),
    db.select({ id: categories.id, name: categories.name, parentId: categories.parentId })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select({
      scheduledId: scheduledForecasts.scheduledId,
      occurrenceDate: scheduledForecasts.occurrenceDate,
      amount: scheduledForecasts.amount,
    }).from(scheduledForecasts).orderBy(asc(scheduledForecasts.occurrenceDate)),
  ]);

  return (
    <div className="lg:h-screen lg:flex lg:flex-col">
      <Topbar
        title="Scheduled Transactions"
        actions={
          <>
            <ScheduleSuggestionsPanel />
            <NewScheduledButton />
          </>
        }
      />
      <div className="p-4 lg:p-6 space-y-6 lg:flex-1 lg:min-h-0 lg:overflow-hidden lg:flex lg:flex-col lg:space-y-0">
        <ScheduledListView
          scheduled={rows}
          accounts={accountList}
          categories={categoryList}
          forecasts={forecastList}
        />
      </div>
    </div>
  );
}
