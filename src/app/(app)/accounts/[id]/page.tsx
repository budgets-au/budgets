import { db } from "@/db";
import { accounts, transactions, categories } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import Link from "next/link";
import { AccountHeader } from "@/components/accounts/account-header";
import { Lock } from "lucide-react";

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);

  if (!account) notFound();

  const txns = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      payee: transactions.payee,
      description: transactions.description,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      isReconciled: transactions.isReconciled,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(transactions.accountId, id))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(100);

  return (
    <div>
      <Topbar title={account.name} />
      <div className="p-4 lg:p-6 space-y-4">
        <AccountHeader account={account} />

        {/* Transactions */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Transactions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {txns.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No transactions.{" "}
                <Link href="/transactions" className="underline">
                  Import from your bank
                </Link>
              </p>
            ) : (
              <ul className="divide-y">
                {txns.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between px-4 py-3 hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {t.isReconciled && (
                        <Lock
                          className="h-3 w-3 text-emerald-600 shrink-0"
                          aria-label="Reconciled"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {t.payee || t.description || "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(t.date)}
                          {t.categoryName && (
                            <span className="ml-2 text-muted-foreground/60">· {t.categoryName}</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <p className={`text-sm font-semibold ml-4 shrink-0 ${amountClass(t.amount)}`}>
                      {formatAUD(t.amount)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
