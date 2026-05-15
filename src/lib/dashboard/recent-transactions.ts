import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { transactions, accounts } from "@/db/schema";

/** Generous upper bound — the client widget dynamically slices the
 * list to whatever fits its rendered height, mirroring the upcoming
 * widget's behaviour. */
const MAX_ROWS = 50;

export interface RecentTransactionRow {
  id: string;
  date: string;
  payee: string | null;
  description: string | null;
  notes: string | null;
  amount: string;
  accountId: string;
  accountName: string | null;
  accountColor: string | null;
}

/** Most-recent N transactions across all non-archived accounts.
 * Ordering matches the canonical lineage the transactions list
 * uses (date, posted_seq, posted_at|created_at, id) so the widget
 * agrees with the full view on what "most recent" means — without
 * this the dashboard could disagree with the transactions page on
 * ties. */
export async function getRecentTransactions(): Promise<{
  rows: RecentTransactionRow[];
}> {
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      payee: transactions.payee,
      description: transactions.description,
      notes: transactions.notes,
      amount: transactions.amount,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountColor: accounts.color,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(sql`${accounts.isArchived} = false`)
    .orderBy(
      desc(transactions.date),
      desc(sql`COALESCE(${transactions.postedSeq}, 0)`),
      desc(sql`COALESCE(${transactions.postedAt}, ${transactions.createdAt})`),
      desc(transactions.id),
    )
    .limit(MAX_ROWS);
  return { rows };
}
