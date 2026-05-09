import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, gte } from "drizzle-orm";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD, amountClass, cn } from "@/lib/utils";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { AccountHeader } from "@/components/accounts/account-header";
import { ImportAccountsButton } from "@/components/accounts/import-accounts-button";
import { StocksSummaryCard } from "@/components/dashboard/stocks-summary-card";
import { SuperSummaryCard } from "@/components/dashboard/super-summary-card";
import { UpcomingSchedulesCard } from "@/components/dashboard/upcoming-schedules-card";

export default async function DashboardPage() {
  await auth();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);

  const [allAccounts, recentTxns] = await Promise.all([
    db.select().from(accounts).where(eq(accounts.isArchived, false)),
    db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(gte(transactions.date, thirtyDaysAgoStr)),
  ]);

  const totalBalance = allAccounts.reduce(
    (sum, a) => sum + parseFloat(a.currentBalance),
    0
  );

  const TYPE_ORDER = ["checking", "savings", "cash", "credit", "loan"];
  const TYPE_LABELS: Record<string, string> = {
    checking: "Checking",
    savings: "Savings",
    cash: "Cash",
    credit: "Credit",
    loan: "Loans",
  };
  const groupedAccounts = TYPE_ORDER.map((t) => ({
    type: t,
    label: TYPE_LABELS[t],
    accounts: allAccounts.filter((a) => a.type === t),
  }))
    .concat([
      {
        type: "_other",
        label: "Other",
        accounts: allAccounts.filter((a) => !TYPE_ORDER.includes(a.type)),
      },
    ])
    .filter((g) => g.accounts.length > 0);

  const totalIncome = recentTxns
    .filter((t) => parseFloat(t.amount) > 0)
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
  const totalExpenses = recentTxns
    .filter((t) => parseFloat(t.amount) < 0)
    .reduce((sum, t) => sum + Math.abs(parseFloat(t.amount)), 0);

  return (
    <div>
      <Topbar title="Dashboard" />
      <div className="p-4 lg:p-6 space-y-4">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          <Card data-size="sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Net Worth
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold ${amountClass(totalBalance)}`}>
                {formatAUD(totalBalance)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                across {allAccounts.length} account{allAccounts.length !== 1 ? "s" : ""}
              </p>
            </CardContent>
          </Card>

          <Card data-size="sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Income (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-emerald-600">{formatAUD(totalIncome)}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <ArrowUpRight className="h-3 w-3 text-emerald-600" />
                <span>Money in</span>
              </div>
            </CardContent>
          </Card>

          <Card data-size="sm">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expenses (30 days)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-500">{formatAUD(totalExpenses)}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                <ArrowDownRight className="h-3 w-3 text-red-500" />
                <span>Money out</span>
              </div>
            </CardContent>
          </Card>

          <StocksSummaryCard />
          <SuperSummaryCard />
        </div>

        {/* Accounts */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Accounts
            </h2>
            <div className="flex gap-2">
              <ImportAccountsButton />
              <Link href="/accounts/new" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                <Plus className="h-4 w-4 mr-1" /> New Account
              </Link>
            </div>
          </div>
          {allAccounts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No accounts yet.{" "}
                <Link href="/accounts/new" className="underline">
                  Add your first account
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5 gap-4 items-start">
              {groupedAccounts.map((g) => (
                <div key={g.type} className="space-y-3">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {g.label}
                  </p>
                  {g.accounts.map((account) => (
                    <AccountHeader
                      key={account.id}
                      account={account}
                      href={`/transactions?accountIds=${account.id}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming scheduled transactions — links each row to the
            scheduled-list view with that schedule pre-selected. */}
        <UpcomingSchedulesCard />
      </div>
    </div>
  );
}
