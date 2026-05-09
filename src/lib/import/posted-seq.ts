/**
 * Assigns `postedSeq` to each row by file position, then flips the
 * direction so higher `postedSeq` always means more-recent according
 * to the bank — regardless of whether the file was emitted oldest-
 * first (typical OFX/CSV) or newest-first (some bank exports).
 *
 * This keeps the transactions list's ORDER BY (date, posted_at,
 * posted_seq, id) in sync with the running-balance subquery's tuple
 * comparison: same intra-day key on both sides means the row's
 * computed balance matches what the bank claimed.
 */
export function assignPostedSeq<T extends { date: string; postedSeq?: number | null }>(
  rows: T[],
): void {
  rows.forEach((r, i) => {
    r.postedSeq = i;
  });
  if (rows.length < 2) return;
  const newestFirst = rows[0].date > rows[rows.length - 1].date;
  if (newestFirst) {
    rows.forEach((r, i) => {
      r.postedSeq = rows.length - 1 - i;
    });
  }
}
