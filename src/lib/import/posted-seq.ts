/**
 * Assigns `postedSeq` to each row so the running-balance subquery's
 * tuple compare `(date, posted_seq, posted_at|created_at, id) <=`
 * orders intra-day rows the way the bank actually emitted them.
 *
 * Two-tier strategy:
 *
 *   1. **Balance reconciliation.** If every row carries both a
 *      runningBalance and an amount, the order is uniquely
 *      determined by the chain `prev + amount = next` — i.e. at each
 *      step we pick the row whose `balance - amount` matches the
 *      previous row's balance. This works for mixed-sign days where
 *      a naïve sort-by-balance gets the direction wrong (a day
 *      that ends lower than it started would put the LATEST row at
 *      the front when sorted by balance ASC). For the file's first
 *      date we try each row as the potential start and accept the
 *      unique resolution; for subsequent dates we anchor to the
 *      previous date's last balance.
 *   2. **File position with strict direction-flip.** If any row is
 *      missing its balance, or if reconciliation can't resolve a
 *      unique order, fall back to numbering rows by their file
 *      position with a flip when ANY date inversion is detected
 *      (rows[i].date > rows[i+1].date for some i). The first-vs-last
 *      comparison the old code used silently no-op'd on same-date
 *      files; checking inversions everywhere catches files the bank
 *      emits newest-first.
 */
export function assignPostedSeq<
  T extends {
    date: string;
    amount: string;
    postedSeq?: number | null;
    runningBalance?: string | null;
  },
>(rows: T[]): void {
  if (rows.length === 0) return;
  if (rows.length === 1) {
    rows[0].postedSeq = 0;
    return;
  }

  // Tier 1: balance reconciliation.
  if (rowsHaveCompleteBalance(rows)) {
    const ordered = orderByReconciliation(rows);
    if (ordered) {
      ordered.forEach((r, i) => {
        r.postedSeq = i;
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

function rowsHaveCompleteBalance<
  T extends { runningBalance?: string | null; amount: string },
>(rows: T[]): boolean {
  for (const r of rows) {
    if (r.runningBalance == null) return false;
    if (!Number.isFinite(parseFloat(r.runningBalance))) return false;
    if (!Number.isFinite(parseFloat(r.amount))) return false;
  }
  return true;
}

/** Walk the file in date order, deriving each date's intra-day
 * order via balance reconciliation. Returns null if any date can't
 * be uniquely resolved — caller falls back to file position. */
function orderByReconciliation<
  T extends { date: string; amount: string; runningBalance?: string | null },
>(rows: T[]): T[] | null {
  const byDate = new Map<string, T[]>();
  for (const r of rows) {
    const arr = byDate.get(r.date) ?? [];
    arr.push(r);
    byDate.set(r.date, arr);
  }
  const sortedDates = Array.from(byDate.keys()).sort();
  const out: T[] = [];
  let anchor: number | null = null;
  for (const date of sortedDates) {
    const dayRows = byDate.get(date)!;
    const dayOrdered =
      anchor != null
        ? reconcileDay(dayRows, anchor)
        : reconcileFirstDay(dayRows);
    if (!dayOrdered) return null;
    out.push(...dayOrdered);
    anchor = parseFloat(dayOrdered[dayOrdered.length - 1].runningBalance!);
  }
  return out;
}

/** Greedy reconciliation from a known starting balance. At each
 * step, the unique row whose `balance - amount === prev` is the
 * next row in bank chronology. Returns null if at any step zero
 * or more-than-one row matches. */
function reconcileDay<
  T extends { amount: string; runningBalance?: string | null },
>(dayRows: T[], anchor: number): T[] | null {
  const remaining = dayRows.slice();
  const out: T[] = [];
  let prev = anchor;
  while (remaining.length > 0) {
    let matchIdx = -1;
    let matchCount = 0;
    for (let i = 0; i < remaining.length; i++) {
      const r = remaining[i];
      const diff =
        parseFloat(r.runningBalance!) - prev - parseFloat(r.amount);
      if (Math.abs(diff) < 0.01) {
        matchIdx = i;
        matchCount += 1;
        if (matchCount > 1) return null;
      }
    }
    if (matchCount !== 1) return null;
    const picked = remaining.splice(matchIdx, 1)[0];
    out.push(picked);
    prev = parseFloat(picked.runningBalance!);
  }
  return out;
}

/** First-date reconciliation: we don't know the pre-day starting
 * balance, so try each row as the potential first row of the day.
 * Each candidate implies a starting anchor of `balance - amount`;
 * if exactly one anchor produces a valid full-day reconciliation,
 * accept it. If multiple work (e.g. a $5-in / $5-out round-trip),
 * the order is genuinely ambiguous — caller falls back to file
 * position. */
function reconcileFirstDay<
  T extends { amount: string; runningBalance?: string | null },
>(dayRows: T[]): T[] | null {
  if (dayRows.length === 1) return dayRows.slice();
  const valid: T[][] = [];
  for (const start of dayRows) {
    const candidateAnchor =
      parseFloat(start.runningBalance!) - parseFloat(start.amount);
    const tried = reconcileDay(dayRows, candidateAnchor);
    if (tried) valid.push(tried);
    if (valid.length > 1) return null;
  }
  return valid.length === 1 ? valid[0] : null;
}

function hasAnyDateInversion<T extends { date: string }>(rows: T[]): boolean {
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].date > rows[i].date) return true;
  }
  return false;
}
