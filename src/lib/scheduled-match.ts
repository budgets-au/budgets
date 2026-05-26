import { diffDaysISO } from "@/lib/utils";

/** Default date tolerance for fixed-amount schedules. Mirrors the value
 * the scheduled list view has used historically. */
export const MATCH_TOLERANCE_DAYS = 5;
/** Date tolerance ceiling for range-mode schedules (variable bills). */
export const MATCH_TOLERANCE_DAYS_RANGE = 14;

/** Approximate cadence (days) per frequency. Used to clamp the range-mode
 * tolerance so a tolerance window can't span more than half a cadence —
 * otherwise adjacent occurrences' windows overlap and the greedy match
 * pulls a txn into the wrong slot. */
export const APPROX_CADENCE_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

export interface MatchableOccurrence {
  date: string; // YYYY-MM-DD
  accountId: string;
  amount: number;
}

export interface MatchableTxn {
  id: string;
  accountId: string;
  date: string;
  amount: string | number;
  categoryId: string | null;
}

export interface MatchScheduleOptions {
  /** Lower bound of the acceptable amount band for range-mode schedules.
   * When null/undefined, matching is exact-amount within $0.01. */
  rangeMin?: number | null;
  /** Frequency + interval drive the range-mode tolerance ceiling. */
  frequency: string;
  interval: number;
  /** When set, only txns whose categoryId is in this set are eligible.
   * Required for range-mode (otherwise a same-amount unrelated txn could
   * be claimed). */
  allowedCategoryIds?: Set<string> | null;
  /** Range-mode pin: txns must fall inside the schedule's own
   * [startDate, endDate] window. Applied alongside the per-occurrence
   * date tolerance below. */
  scheduleStartDate?: string | null;
  scheduleEndDate?: string | null;
  /** Greedy claims tracked across calls. New claims are added in-place.
   * Pass the same Set when matching a sibling lineage so a txn can't be
   * claimed by two schedules. */
  claimedTxnIds: Set<string>;
}

export interface MatchResult {
  matched: { occurrence: MatchableOccurrence; txnId: string; days: number }[];
  unmatched: MatchableOccurrence[];
}

function dateToleranceFor(opts: MatchScheduleOptions): number {
  if (opts.rangeMin == null) return MATCH_TOLERANCE_DAYS;
  const cadence = (APPROX_CADENCE_DAYS[opts.frequency] ?? 30) * (opts.interval || 1);
  return Math.min(MATCH_TOLERANCE_DAYS_RANGE, Math.floor(cadence / 2));
}

/**
 * Greedy newest-first match for one schedule's projected occurrences
 * against a candidate transaction pool. Txn ids that match are added to
 * `opts.claimedTxnIds` so subsequent calls (for sibling schedules in a
 * lineage, or different schedules sharing the txn pool) skip them.
 *
 * Used by both the scheduled list view and the missed-scheduled panel
 * on the transactions page so the two surfaces always agree on what
 * counts as matched.
 */
export function matchSchedule(
  occurrences: MatchableOccurrence[],
  txns: MatchableTxn[],
  opts: MatchScheduleOptions,
): MatchResult {
  const dateTolerance = dateToleranceFor(opts);
  const matched: MatchResult["matched"] = [];
  const unmatched: MatchResult["unmatched"] = [];

  // Newest-first: when two adjacent occurrences both fit a single txn,
  // the more recent one wins it (older becomes "missed" earlier in the
  // history, which feels right).
  const occs = [...occurrences].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  for (const occ of occs) {
    const occMag = Math.abs(occ.amount);
    const occSign = Math.sign(occ.amount);
    let bestId: string | null = null;
    let bestDays = Infinity;
    for (const t of txns) {
      if (opts.claimedTxnIds.has(t.id)) continue;
      if (t.accountId !== occ.accountId) continue;
      if (opts.allowedCategoryIds) {
        if (!t.categoryId || !opts.allowedCategoryIds.has(t.categoryId)) continue;
      }
      // Range-mode also pins txns to the schedule's real start/end window —
      // a variable-amount bill only exists from when the user says it did,
      // so anything earlier that happens to land in the amount band is
      // unrelated noise.
      if (opts.rangeMin != null) {
        if (opts.scheduleStartDate && t.date < opts.scheduleStartDate) continue;
        if (opts.scheduleEndDate && t.date > opts.scheduleEndDate) continue;
      }
      const tAmt = typeof t.amount === "string" ? parseFloat(t.amount) : t.amount;
      if (opts.rangeMin != null) {
        // Range mode: same direction, magnitude inside [rangeMin, |occ|].
        if (occSign !== 0 && Math.sign(tAmt) !== occSign) continue;
        const tMag = Math.abs(tAmt);
        if (tMag < opts.rangeMin - 0.01 || tMag > occMag + 0.01) continue;
      } else if (Math.abs(tAmt - occ.amount) > 0.01) {
        continue;
      }
      const days = Math.abs(diffDaysISO(t.date, occ.date));
      if (days > dateTolerance) continue;
      if (days < bestDays) {
        bestDays = days;
        bestId = t.id;
      }
    }
    if (bestId) {
      opts.claimedTxnIds.add(bestId);
      matched.push({ occurrence: occ, txnId: bestId, days: bestDays });
    } else {
      unmatched.push(occ);
    }
  }

  return { matched, unmatched };
}
