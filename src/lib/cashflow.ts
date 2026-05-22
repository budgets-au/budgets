import { addDays, isAfter } from "date-fns";
import type { Account, Transaction, ScheduledTransaction } from "@/db/schema";
import { expandRecurrence } from "./recurrence";
import { toISO } from "./utils";

export interface CashflowEvent {
  date: string;
  amount: number;
  payee: string;
  description: string;
  isProjected: boolean;
  id?: string;
  accountId?: string;
  /** Scheduled-row kind (set on projected events only). Budget
   * schedules carry `kind: "budget"`; the calendar's
   * real-vs-scheduled matcher excludes those because a budget is
   * a cap, not a single outflow — without this tag a "$200
   * weekly Groceries" budget will falsely claim any random $200
   * grocery transaction as its fulfilment, mis-matching the day
   * panel + the dot positions. */
  kind?: string;
}

export interface DailyBalance {
  date: string;
  balance: number;
  events: CashflowEvent[];
  scheduledEvents: CashflowEvent[]; // recurring occurrences for this day, always present regardless of past/future
  hasProjected: boolean;
}

export interface AccountSeries {
  id: string;
  name: string;
  color: string;
  daily: { date: string; balance: number }[];
}

export interface CashflowResult {
  daily: DailyBalance[];
  perAccount: AccountSeries[];
}

/**
 * Compute the daily balance series for a single account in [from, to].
 *
 * Walks forward from `from` to `to`. The day-zero balance is derived from
 * `account.currentBalance` (= today's balance) by subtracting every real
 * transaction with `date >= fromStr`. This is correct regardless of whether
 * `to` is in the past or future, *as long as the caller has supplied every
 * real transaction with `date >= fromStr`* (not bounded by `to`). Future days
 * use real-or-projected events; past/today use real only.
 */
function computeAccountSeries({
  account,
  realByDate,
  projectedByDate,
  from,
  to,
}: {
  account: Account;
  realByDate: Map<string, CashflowEvent[]>;
  projectedByDate: Map<string, CashflowEvent[]>;
  from: Date;
  to: Date;
}): { date: string; balance: number; events: CashflowEvent[]; scheduledEvents: CashflowEvent[] }[] {
  const today = toISO(new Date());
  const fromStr = toISO(from);

  let runningBalance = parseFloat(account.currentBalance);
  // Roll back to the start-of-day balance on `fromStr` by undoing every real
  // transaction with date >= fromStr (they're already baked into currentBalance).
  for (const [date, events] of realByDate) {
    if (date >= fromStr) {
      for (const e of events) runningBalance -= e.amount;
    }
  }

  const out: { date: string; balance: number; events: CashflowEvent[]; scheduledEvents: CashflowEvent[] }[] = [];
  let cursor = new Date(from);
  while (!isAfter(cursor, to)) {
    const dateStr = toISO(cursor);
    const real = realByDate.get(dateStr) ?? [];
    const projected = projectedByDate.get(dateStr) ?? [];
    const isPast = dateStr <= today;
    const dayEvents: CashflowEvent[] = isPast
      ? real
      : [...real, ...projected.filter(
          (p) => !real.some((r) => r.payee === p.payee && r.amount === p.amount),
        )];
    for (const e of dayEvents) runningBalance += e.amount;
    out.push({
      date: dateStr,
      balance: Math.round(runningBalance * 100) / 100,
      events: dayEvents,
      scheduledEvents: projected,
    });
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** The narrow projection `computeCashflow` actually reads from each
 *  transaction row. Issue #77: declaring this narrower than
 *  `Transaction` lets `/api/cashflow` SELECT just these fields
 *  instead of `SELECT *` — material savings on accounts with deep
 *  history because every other column (notes, isTransfer, importHash,
 *  rawFitid, postedAt, etc.) gets skipped over the wire and through
 *  JSON.stringify. */
export type CashflowTransaction = Pick<
  Transaction,
  "id" | "accountId" | "date" | "amount" | "payee" | "description"
>;

export function computeCashflow({
  accounts,
  realTransactions,
  scheduledTransactions,
  from,
  to,
  accountIds,
}: {
  accounts: Account[];
  realTransactions: CashflowTransaction[];
  scheduledTransactions: ScheduledTransaction[];
  from: Date;
  to: Date;
  accountIds?: string[];
}): CashflowResult {
  const filterAccounts = accountIds?.length ? new Set(accountIds) : null;
  const relevantAccounts = filterAccounts
    ? accounts.filter((a) => filterAccounts.has(a.id))
    : accounts;

  // Group real txns by (accountId, date) so each per-account series can be
  // computed independently. Caller is expected to have fetched every real
  // transaction with date >= from (no upper bound), otherwise the back-compute
  // step undershoots when `to` is in the past.
  const realByAccountDate = new Map<string, Map<string, CashflowEvent[]>>();
  for (const t of realTransactions) {
    if (filterAccounts && !filterAccounts.has(t.accountId)) continue;
    let perDate = realByAccountDate.get(t.accountId);
    if (!perDate) {
      perDate = new Map();
      realByAccountDate.set(t.accountId, perDate);
    }
    const existing = perDate.get(t.date) ?? [];
    existing.push({
      date: t.date,
      amount: parseFloat(t.amount),
      payee: t.payee ?? "",
      description: t.description ?? "",
      isProjected: false,
      id: t.id,
      accountId: t.accountId,
    });
    perDate.set(t.date, existing);
  }

  const todayStr = toISO(new Date());
  const projectedByAccountDate = new Map<string, Map<string, CashflowEvent[]>>();
  for (const s of scheduledTransactions) {
    // Include active schedules AND superseded predecessors (the
    // replace flow at /api/scheduled/[id]/replace flips
    // isActive=false and sets endDate). The endDate bounds
    // expandRecurrence below, so a predecessor's projection never
    // crosses into the successor's window — only its realised past
    // occurrences light up. Schedules paused manually (isActive=
    // false, endDate=null) stay excluded. Belt-and-braces — both
    // /api/cashflow and /api/reports/cashflow apply the same filter
    // in SQL, but a caller could legitimately pass us pre-fetched
    // data, so we enforce it here too.
    if (!s.isActive && !s.endDate) continue;
    // For transfers, expandRecurrence emits two events (source + destination).
    // We can't pre-filter on `s.accountId` because the destination side might
    // be the only one in scope. Instead, filter at the per-event level below.
    // `includeBudgets: true` so weekly/monthly cap-style schedules project
    // forward.
    const projected = expandRecurrence(s, from, to, { includeBudgets: true });
    // Budget schedules have no real-txn counterpart, so the past-period
    // occurrences are meaningless clutter on the calendar (they'd show as
    // "scheduled but missed"). Drop budget occurrences on/before today —
    // forward-only is the useful forecast. Non-budget schedules retain their
    // past occurrences so the existing real-vs-scheduled match logic works.
    const filtered = s.kind === "budget"
      ? projected.filter((p) => p.date > todayStr)
      : projected;
    for (const p of filtered) {
      if (filterAccounts && !filterAccounts.has(p.accountId)) continue;
      let perDate = projectedByAccountDate.get(p.accountId);
      if (!perDate) {
        perDate = new Map();
        projectedByAccountDate.set(p.accountId, perDate);
      }
      const existing = perDate.get(p.date) ?? [];
      existing.push({
        date: p.date,
        amount: parseFloat(p.amount),
        payee: p.payee,
        description: p.description,
        isProjected: true,
        id: p.scheduledId,
        accountId: p.accountId,
        kind: s.kind,
      });
      perDate.set(p.date, existing);
    }
  }

  // Per-account series.
  const perAccount: AccountSeries[] = relevantAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    daily: computeAccountSeries({
      account: a,
      realByDate: realByAccountDate.get(a.id) ?? new Map(),
      projectedByDate: projectedByAccountDate.get(a.id) ?? new Map(),
      from,
      to,
    }).map(({ date, balance }) => ({ date, balance })),
  }));

  // Combined series — sum per-account balances and merge events for the
  // calendar grid + projected-flag display.
  const dateOrder: string[] = [];
  let cursor = new Date(from);
  while (!isAfter(cursor, to)) {
    dateOrder.push(toISO(cursor));
    cursor = addDays(cursor, 1);
  }

  const accountSeriesByDate: Map<string, Map<string, number>> = new Map();
  for (const series of perAccount) {
    const m = new Map<string, number>();
    for (const d of series.daily) m.set(d.date, d.balance);
    accountSeriesByDate.set(series.id, m);
  }

  // Re-derive per-day events by union across accounts (used for the calendar grid).
  const eventsByDate = new Map<string, CashflowEvent[]>();
  const scheduledByDate = new Map<string, CashflowEvent[]>();
  for (const a of relevantAccounts) {
    const realM = realByAccountDate.get(a.id) ?? new Map();
    const projM = projectedByAccountDate.get(a.id) ?? new Map();
    for (const [d, evs] of realM) {
      eventsByDate.set(d, [...(eventsByDate.get(d) ?? []), ...evs]);
    }
    for (const [d, evs] of projM) {
      scheduledByDate.set(d, [...(scheduledByDate.get(d) ?? []), ...evs]);
    }
  }

  const today = toISO(new Date());
  const daily: DailyBalance[] = dateOrder.map((dateStr) => {
    const real = eventsByDate.get(dateStr) ?? [];
    const projected = scheduledByDate.get(dateStr) ?? [];
    const isPast = dateStr <= today;
    const merged = isPast
      ? real
      : [...real, ...projected.filter(
          (p) => !real.some((r) => r.payee === p.payee && r.amount === p.amount && r.accountId === p.accountId),
        )];
    let total = 0;
    for (const series of perAccount) {
      total += accountSeriesByDate.get(series.id)?.get(dateStr) ?? 0;
    }
    return {
      date: dateStr,
      balance: Math.round(total * 100) / 100,
      events: merged,
      scheduledEvents: projected,
      hasProjected: merged.some((e) => e.isProjected),
    };
  });

  return { daily, perAccount };
}

// ─── Day summary helper ───────────────────────────────────────────────────────
// Compresses a `DailyBalance` (or a synthetic version of one) into the three
// signals the calendar's day-cell renders as coloured dots. Pure function so
// both the cell and the unit tests can call it without setting up React.
//
// `hasIn`/`hasOut` reflect actual transactions only — projected/scheduled
// occurrences feed `hasPlanned`. A scheduled occurrence that has already
// been matched to a real transaction is *not* counted as planned (the dot
// follows the money to the day the real txn posted, matching the existing
// behaviour in the calendar's match logic).

export interface DaySummaryInput {
  /** Actual transactions for the day (post-projection filter). */
  events: { amount: number; isProjected: boolean }[];
  /** All scheduled occurrences for the day. The caller is responsible for
   * culling already-matched scheds before passing them in if it wants
   * dot-on-real-day semantics; the helper just reports presence. */
  scheduledEvents: { amount: number }[];
}

export interface DaySummary {
  hasIn: boolean;
  hasOut: boolean;
  hasPlanned: boolean;
  /** Signed sum of real (non-projected) transactions for the day. */
  net: number;
}

export function summarizeDay(d: DaySummaryInput | undefined): DaySummary {
  if (!d) return { hasIn: false, hasOut: false, hasPlanned: false, net: 0 };
  let hasIn = false;
  let hasOut = false;
  let net = 0;
  for (const e of d.events) {
    if (e.isProjected) continue;
    if (e.amount > 0) hasIn = true;
    else if (e.amount < 0) hasOut = true;
    net += e.amount;
  }
  const hasPlanned = d.scheduledEvents.length > 0;
  // Round to cents so floating-point dust doesn't surface in summary text.
  return { hasIn, hasOut, hasPlanned, net: Math.round(net * 100) / 100 };
}

/** Sum the realised (non-projected) net across a list of daily balances —
 * used by the calendar's per-week footer. */
export function weekNet(days: { events: { amount: number; isProjected: boolean }[] }[]): number {
  let n = 0;
  for (const d of days) {
    for (const e of d.events) {
      if (!e.isProjected) n += e.amount;
    }
  }
  return Math.round(n * 100) / 100;
}
