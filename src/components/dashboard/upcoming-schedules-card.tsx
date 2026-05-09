import Link from "next/link";
import { Repeat } from "lucide-react";
import { addDays, parseISO } from "date-fns";
import { db } from "@/db";
import { scheduledTransactions, accounts, transactions } from "@/db/schema";
import { eq, and, ne, gte, inArray, sql } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { expandRecurrence } from "@/lib/recurrence";
import { colourForFrequency, freqLabel } from "@/lib/schedule-colours";
import { formatAUD, amountClass, formatDate } from "@/lib/utils";

const HORIZON_DAYS = 30;
const MAX_ROWS = 10;
/** Tolerance for considering an upcoming occurrence already paid — same
 * window the scheduled list uses for its greedy matcher. */
const MATCH_TOLERANCE_DAYS = 5;
/** Amount equality tolerance, in dollars. */
const AMOUNT_TOLERANCE = 1.0;

interface Row {
  scheduledId: string;
  date: string;
  frequency: string;
  interval: number;
  payee: string | null;
  amount: string;
  accountName: string | null;
  accountColor: string | null;
}

function relativeWord(today: Date, target: Date): string {
  const ms = target.getTime() - today.getTime();
  const days = Math.round(ms / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return `In ${days} days`;
  if (days < 14) return "Next week";
  if (days < 30) return `In ${Math.floor(days / 7)} weeks`;
  return formatDate(target);
}

export async function UpcomingSchedulesCard() {
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

  // Recent + horizon-window transactions per scheduled account, used to
  // skip occurrences that are already posted within tolerance.
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
  // Per-account index for fast amount/date lookup.
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

  const events: Row[] = [];
  for (const r of schedules) {
    const occurrences = expandRecurrence(r.schedule, today, horizon);
    for (const o of occurrences) {
      // Transfer schedules emit both a source (debit) and a destination
      // (credit) event. Show only the debit side — the row's amount is
      // the schedule's stored amount, and the destination is implicit.
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
  const rows = events.slice(0, MAX_ROWS);

  return (
    <Card data-size="sm">
      <CardHeader className="pb-1 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Upcoming
        </CardTitle>
        <Link
          href="/scheduled"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          See all →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Nothing due in the next {HORIZON_DAYS} days.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((row, i) => {
              const target = parseISO(row.date);
              const amt = parseFloat(row.amount);
              return (
                <li key={`${row.scheduledId}-${row.date}-${i}`}>
                  <Link
                    href={`/scheduled?id=${row.scheduledId}`}
                    className="grid items-center gap-3 px-4 py-1.5 text-sm hover:bg-muted/60 transition-colors"
                    style={{
                      // Fixed column template so amounts/dates line up
                      // across rows. Account column collapses to 0 on
                      // smaller screens via the hidden span below.
                      gridTemplateColumns:
                        "90px 90px minmax(0, 1fr) 110px 90px",
                    }}
                  >
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap justify-self-start"
                      style={{ backgroundColor: colourForFrequency(row.frequency) }}
                    >
                      <Repeat className="h-2.5 w-2.5" aria-hidden="true" />
                      {freqLabel(row.frequency, row.interval)}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {relativeWord(today, target)}
                    </span>
                    <span className="font-medium truncate min-w-0">
                      {row.payee ?? "—"}
                    </span>
                    <span className="hidden sm:flex justify-start min-w-0">
                      {row.accountName && (
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap truncate max-w-full"
                          style={{
                            backgroundColor: row.accountColor ?? "#94a3b8",
                          }}
                        >
                          {row.accountName}
                        </span>
                      )}
                    </span>
                    <span
                      className={`tabular-nums font-medium whitespace-nowrap text-right ${amountClass(amt)}`}
                    >
                      {formatAUD(amt)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
