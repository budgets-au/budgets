/**
 * Assigns `postedSeq` to each row so the running-balance subquery's
 * tuple compare `(date, posted_seq, posted_at|created_at, id) <=`
 * orders intra-day rows the way the bank actually emitted them.
 *
 * Two-tier strategy:
 *
 *   1. If every row carries a `runningBalance` AND those values form
 *      a strictly-monotonic order when sorted by (date asc, balance
 *      asc), use balance as the canonical signal. The bank's
 *      post-transaction balance uniquely orders every row across the
 *      whole file — that's a stronger signal than file position
 *      because it survives newest-first vs oldest-first files AND
 *      same-date files the file-position-only path can't disambiguate.
 *   2. Otherwise fall back to file position with a stricter
 *      newest-first detector: any date inversion anywhere along the
 *      file (rows[i].date > rows[i+1].date for some i) is taken as
 *      proof the file is newest-first, and the whole array is
 *      reversed. The first-vs-last comparison alone was a corner case
 *      bug — a same-date file the bank emits newest-first never
 *      tripped that strict-greater check, so intra-day order stayed
 *      reversed.
 *
 * The strict-monotonic check guards against ambiguity: if two rows
 * end at the same balance (a $5 in immediately matched by a $5 out,
 * or any zero-net round-trip), balance can't disambiguate them and
 * the parser falls back to file position rather than picking one
 * arbitrarily.
 */
export function assignPostedSeq<
  T extends {
    date: string;
    postedSeq?: number | null;
    runningBalance?: string | null;
  },
>(rows: T[]): void {
  if (rows.length === 0) return;
  if (rows.length === 1) {
    rows[0].postedSeq = 0;
    return;
  }

  // Tier 1: balance-derived order (if available + monotonic).
  if (rowsHaveCompleteBalance(rows)) {
    const sorted = rows
      .map((r, i) => ({
        r,
        i,
        balance: parseFloat(r.runningBalance ?? "NaN"),
      }))
      .sort((a, b) => {
        if (a.r.date !== b.r.date) return a.r.date < b.r.date ? -1 : 1;
        if (a.balance !== b.balance) return a.balance - b.balance;
        // Same date and same balance → can't disambiguate; preserve
        // input order so we degrade gracefully into "file position".
        return a.i - b.i;
      });
    // If after sorting every (date, balance) pair is unique, accept
    // the balance-derived order. Otherwise (ties present) we can't
    // trust it — drop to tier 2.
    if (allPairsUnique(sorted)) {
      sorted.forEach((entry, idx) => {
        entry.r.postedSeq = idx;
      });
      return;
    }
  }

  // Tier 2: file position with stricter newest-first detection.
  rows.forEach((r, i) => {
    r.postedSeq = i;
  });
  if (hasAnyDateInversion(rows)) {
    rows.forEach((r, i) => {
      r.postedSeq = rows.length - 1 - i;
    });
  }
}

function rowsHaveCompleteBalance<T extends { runningBalance?: string | null }>(
  rows: T[],
): boolean {
  for (const r of rows) {
    if (r.runningBalance == null) return false;
    if (!Number.isFinite(parseFloat(r.runningBalance))) return false;
  }
  return true;
}

function allPairsUnique<T extends { r: { date: string }; balance: number }>(
  sorted: T[],
): boolean {
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a.r.date === b.r.date && a.balance === b.balance) return false;
  }
  return true;
}

function hasAnyDateInversion<T extends { date: string }>(rows: T[]): boolean {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].date > rows[i].date) return true;
  }
  return false;
}
