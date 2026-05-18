import Link from "next/link";
import { Sparkles } from "lucide-react";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/** Server-rendered banner shown above the transactions list when
 *  this database still has any sample data on it. The starter
 *  dataset seeded on first unlock would otherwise quietly mix into
 *  the operator's real transactions and inflate every report — the
 *  notice surfaces "there's demo data in here" with a one-click
 *  jump to Settings → Security, where the admin can remove it.
 *
 *  Renders nothing when nothing is tagged sample. Visible to every
 *  role (non-admins land on /settings but can't actually remove the
 *  data; the notice is informational either way). */
export async function SampleDataNotice() {
  const [sampleAccountRow, sampleTxnRow] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)` })
      .from(accounts)
      .where(eq(accounts.isSample, true)),
    db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(eq(transactions.isSample, true)),
  ]);
  const sampleAccounts = Number(sampleAccountRow[0]?.n ?? 0);
  const sampleTxns = Number(sampleTxnRow[0]?.n ?? 0);
  if (sampleAccounts === 0 && sampleTxns === 0) return null;

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2 text-xs flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          Sample data is mixed in with your transactions
          {sampleTxns > 0
            ? ` (${sampleTxns} sample transaction${sampleTxns === 1 ? "" : "s"} across ${sampleAccounts} sample account${sampleAccounts === 1 ? "" : "s"})`
            : ` (${sampleAccounts} sample account${sampleAccounts === 1 ? "" : "s"})`}
          {" "}— remove it once you&rsquo;ve started importing real data.
        </span>
      </div>
      <Link
        href="/settings?tab=security"
        className="shrink-0 underline hover:text-amber-900 dark:hover:text-amber-200"
      >
        Remove →
      </Link>
    </div>
  );
}
