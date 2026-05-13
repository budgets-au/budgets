import { addDays, parseISO } from "date-fns";
import { eq, and, ne, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { scheduledTransactions, accounts, transactions } from "@/db/schema";
import { expandRecurrence } from "@/lib/recurrence";

const HORIZON_DAYS = 30;
/** Generous upper bound — the client widget dynamically slices the
 * list to whatever fits its rendered height, so we hand back a
 * comfortable buffer rather than the historical hard-cap of 10. */
const MAX_ROWS = 50;
/** Tolerance for considering an upcoming occurrence already paid —
 * same window the scheduled list uses for its greedy matcher. */
const MATCH_TOLERANCE_DAYS = 5;
/** Amount equality tolerance, in dollars. */
const AMOUNT_TOLERANCE = 1.0;

export interface UpcomingScheduleRow {
  scheduledId: string;
  date: string;
  frequency: string;
  interval: number;
  payee: string | null;
  amount: string;
  accountName: string | null;
  accountColor: string | null;
}

/** Compute the next-N-day upcoming schedule rows. Lifted out of the
 * dashboard widget so the API route and any future server-side
 * render can share the same expansion + already-paid skipping
 * logic. */
export async function getUpcomingSchedules(): Promise<{
  rows: UpcomingScheduleRow[];
  horizonDays: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = addDays(today, HORIZON_DAYS);

  const schedules = await db
    .select({
      schedule: scheduledTransactions,
      accountName: accounts.name,
      accountColor: accounts.color,
    })
    .from(scheduledTransactions)
    .leftJoin(accounts, eq(scheduledTransactions.accountId, accounts.id))
    .where(
      and(
        eq(scheduledTransactions.isActive, true),
        ne(scheduledTransactions.kind, "budget"),
      ),
    );

  const accountIds = Array.from(
    new Set(
      schedules
        .map((s) => s.schedule.accountId)
        .filter((id): id is string => !!id),
    ),
  );
  const matchWindowStart = addDays(today, -MATCH_TOLERANCE_DAYS)
    .toISOString()
    .slice(0, 10);
  const recentTxns =
    accountIds.length > 0
      ? await db
          .select({
            accountId: transactions.accountId,
            date: transactions.date,
            amount: transactions.amount,
          })
          .from(transactions)
          .where(
            and(
              inArray(transactions.accountId, accountIds),
              gte(transactions.date, matchWindowStart),
            ),
          )
      : [];
  const txByAccount = new Map<string, { date: string; amount: number }[]>();
  for (const t of recentTxns) {
    const arr = txByAccount.get(t.accountId) ?? [];
    arr.push({ date: t.date, amount: parseFloat(t.amount) });
    txByAccount.set(t.accountId, arr);
  }

  function isAlreadyPaid(
    accountId: string,
    occurrenceDate: string,
    amount: number,
  ): boolean {
    const txns = txByAccount.get(accountId);
    if (!txns) return false;
    const occ = parseISO(occurrenceDate).getTime();
    for (const t of txns) {
      if (Math.abs(t.amount - amount) > AMOUNT_TOLERANCE) continue;
      const dt = parseISO(t.date).getTime();
      const days = Math.abs((dt - occ) / 86400000);
      if (days <= MATCH_TOLERANCE_DAYS) return true;
    }
    return false;
  }

  const events: UpcomingScheduleRow[] = [];
  for (const r of schedules) {
    const occurrences = expandRecurrence(r.schedule, today, horizon);
    for (const o of occurrences) {
      // Transfer schedules emit both a source (debit) and a
      // destination (credit) event. Show only the debit side.
      if (o.accountId !== r.schedule.accountId) continue;
      const amount = parseFloat(o.amount);
      if (isAlreadyPaid(o.accountId, o.date, amount)) continue;
      events.push({
        scheduledId: r.schedule.id,
        date: o.date,
        frequency: r.schedule.frequency,
        interval: r.schedule.interval,
        payee: r.schedule.payee,
        amount: o.amount,
        accountName: r.accountName,
        accountColor: r.accountColor,
      });
    }
  }

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows: events.slice(0, MAX_ROWS), horizonDays: HORIZON_DAYS };
}
