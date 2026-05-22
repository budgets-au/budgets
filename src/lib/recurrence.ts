import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  endOfMonth,
  setDate,
  isAfter,
  isBefore,
  isEqual,
  parseISO,
} from "date-fns";
import type { ScheduledTransaction } from "@/db/schema";
import { formatAmount, toISO } from "@/lib/utils";

/** Subset of the scheduled-transactions row that recurrence projection
 * actually reads. Declared structurally so callers can pass a trimmed
 * `select({...})` result without TS asking for createdAt / updatedAt /
 * lineageId / amountMin / isActive that the projection never touches. */
export type RecurrenceInput = Pick<
  ScheduledTransaction,
  | "id"
  | "kind"
  | "accountId"
  | "transferToAccountId"
  | "amount"
  | "payee"
  | "description"
  | "type"
  | "frequency"
  | "interval"
  | "startDate"
  | "endDate"
  | "dayOfMonth"
>;

export interface ProjectedEvent {
  date: string; // ISO YYYY-MM-DD
  accountId: string;
  amount: string;
  payee: string;
  description: string;
  isProjected: true;
  scheduledId: string;
}

function inRange(d: Date, from: Date, to: Date): boolean {
  return (isAfter(d, from) || isEqual(d, from)) && (isBefore(d, to) || isEqual(d, to));
}

function nextOccurrence(
  current: Date,
  frequency: string,
  interval: number,
  dayOfMonth?: number | null
): Date {
  switch (frequency) {
    case "daily":
      return addDays(current, interval);
    case "weekly":
      return addWeeks(current, interval);
    case "fortnightly":
      return addWeeks(current, 2 * interval);
    case "monthly": {
      const next = addMonths(current, interval);
      if (dayOfMonth) {
        const maxDay = endOfMonth(next).getDate();
        return setDate(next, Math.min(dayOfMonth, maxDay));
      }
      return next;
    }
    case "quarterly": {
      const next = addMonths(current, 3 * interval);
      // Issue #63: re-anchor like the monthly branch. addMonths clamps
      // anchorDay=31 onto a 30-day month, then preserves the (clamped)
      // day on the next call — a "31st every quarter" schedule lands on
      // the 30th forever after.
      if (dayOfMonth) {
        const maxDay = endOfMonth(next).getDate();
        return setDate(next, Math.min(dayOfMonth, maxDay));
      }
      return next;
    }
    case "yearly": {
      const next = addYears(current, interval);
      // Issue #63: re-anchor. addYears clamps Feb 29 → Feb 28 in non-
      // leap years and then preserves the (clamped) 28th forever —
      // misses Feb 29 in the next leap year. dayOfMonth defaulted from
      // the schedule's startDate by expandRecurrence's
      // effectiveDayOfMonth lets us recover the original anchor.
      if (dayOfMonth) {
        const maxDay = endOfMonth(next).getDate();
        return setDate(next, Math.min(dayOfMonth, maxDay));
      }
      return next;
    }
    default:
      return addMonths(current, 1);
  }
}

/**
 * Build the per-occurrence event(s) for a scheduled transaction. Transfers
 * produce two events — one on the source account (the stored amount, which
 * is negative for transfers by convention) and one on the destination with
 * the opposite sign — so projections show on both legs of the transfer.
 *
 * When `transferDualLeg` is false the destination event is omitted. Used by
 * matcher consumers (scheduled list view, missed-scheduled panel,
 * transactions view) where the destination's existence is established via
 * the source-leg match's `transfer_pair_id` instead. Without this opt-out
 * the destination occurrence would fail the matcher's category filter
 * (auto-pairing only categorises the source leg) and surface as a
 * false-positive "missed" warning.
 */
function eventsForOccurrence(
  scheduled: RecurrenceInput,
  cursor: Date,
  transferDualLeg: boolean,
): ProjectedEvent[] {
  // Caller (expandRecurrence) already filters out null-accountId rows.
  if (!scheduled.accountId) return [];
  const date = toISO(cursor);
  const sourceEvent: ProjectedEvent = {
    date,
    accountId: scheduled.accountId,
    amount: scheduled.amount,
    payee: scheduled.payee ?? "",
    description: scheduled.description ?? "",
    isProjected: true,
    scheduledId: scheduled.id,
  };
  if (
    transferDualLeg &&
    scheduled.type === "transfer" &&
    scheduled.transferToAccountId
  ) {
    const destEvent: ProjectedEvent = {
      date,
      accountId: scheduled.transferToAccountId,
      // Opposite sign: source side stores negative, destination credits the
      // same magnitude positively. Avoids double-flipping by toggling the
      // numeric value rather than re-parsing the original string.
      amount: formatAmount(-parseFloat(scheduled.amount)),
      payee: scheduled.payee ?? "",
      description: scheduled.description ?? "",
      isProjected: true,
      scheduledId: scheduled.id,
    };
    return [sourceEvent, destEvent];
  }
  return [sourceEvent];
}

export function expandRecurrence(
  scheduled: RecurrenceInput,
  from: Date,
  to: Date,
  options?: { includeBudgets?: boolean; transferDualLeg?: boolean },
): ProjectedEvent[] {
  // Budgets are spending caps, not specific transactions, so most callers
  // (missed-detection, schedule lists, reports) want them excluded. The
  // calendar's forward projection opts in via `includeBudgets: true` to
  // forecast assumed cap spending into future periods.
  // Rows without an accountId can never project regardless.
  if (!scheduled.accountId) return [];
  if (scheduled.kind === "budget" && !options?.includeBudgets) return [];
  const transferDualLeg = options?.transferDualLeg ?? true;
  const events: ProjectedEvent[] = [];
  const start = parseISO(scheduled.startDate);
  const end = scheduled.endDate ? parseISO(scheduled.endDate) : null;

  if (scheduled.frequency === "once") {
    if (inRange(start, from, to)) {
      events.push(...eventsForOccurrence(scheduled, start, transferDualLeg));
    }
    return events;
  }

  // Walk from start date forward, emitting occurrences within [from, to]
  let cursor = start;
  const rangeEnd = end && isBefore(end, to) ? end : to;

  // Re-anchor monthly schedules by the explicit dayOfMonth if provided;
  // otherwise fall back to the start date's day-of-month. Without this,
  // nextOccurrence has no anchor, so a 31st-of-month schedule that gets
  // clamped to Feb 28 lands on the 28th forever after — addMonths preserves
  // the cursor's current day, which has already been dragged down. The
  // caller's intent is "the 31st (or last available day) every month", so
  // we re-anchor via the original day each step.
  const effectiveDayOfMonth = scheduled.dayOfMonth ?? start.getDate();

  // Fast-forward if start is before our from date
  while (isBefore(cursor, from)) {
    cursor = nextOccurrence(cursor, scheduled.frequency, scheduled.interval, effectiveDayOfMonth);
    if (isAfter(cursor, rangeEnd)) break;
  }

  // Emit all occurrences in range
  while (!isAfter(cursor, rangeEnd)) {
    if (!isBefore(cursor, from)) {
      events.push(...eventsForOccurrence(scheduled, cursor, transferDualLeg));
    }
    cursor = nextOccurrence(cursor, scheduled.frequency, scheduled.interval, effectiveDayOfMonth);
  }

  return events;
}
