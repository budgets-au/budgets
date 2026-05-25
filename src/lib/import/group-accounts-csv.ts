/** Group accounts-CSV rows by account identity and pick each
 *  account's anchor (earliest-date balance) — the data side of the
 *  Westpac-style multi-day-balance import.
 *
 *  Background: Westpac's accounts export emits one row per
 *  (account, date) with that day's closing balance. Treating each
 *  row as a separate `PreviewAccount` collapses via name-dedup but
 *  the *winning* row is whichever happened to be last in Map
 *  insertion order, so `startingBalance` ended up pointing at a
 *  semi-random day inside the period. This helper turns the flat
 *  CSV into one preview per account, anchored at the EARLIEST date
 *  the bank gave us, with the full daily series carried alongside
 *  for the commit route to persist into `bank_balances`. */

export interface AccountCsvInputRow {
  /** Pre-detected, pre-normalised account name. Empty string allowed. */
  name: string;
  /** Pre-detected account type (mapped to one of the app's enum values). */
  type: string;
  institution?: string;
  /** Last 4 digits of the bank's account number; null when the CSV
   *  column was empty. */
  accountNumberLast4?: string;
  /** Decimal string — already passed through `normaliseBalance`. */
  startingBalance: string;
  /** YYYY-MM-DD — the bank's "As at" date for this row's balance.
   *  Optional because rows without a parseable date still get grouped
   *  (under name+last4) but contribute to the series with a null-ish
   *  marker — we drop them from the series since a date is mandatory
   *  on the `bank_balances` table. */
  startingDate?: string;
  isArchived: boolean;
}

export interface GroupedPreviewAccount {
  name: string;
  type: string;
  institution?: string;
  accountNumberLast4?: string;
  /** Anchor balance — from the earliest-date row in the group. */
  startingBalance: string;
  /** Anchor date — earliest-date in the group. */
  startingDate?: string;
  /** Carried straight from the source row (account-level metadata,
   *  same across every row in the group; we pick the first
   *  observed value). `Closing date` in the CSV → archived. */
  isArchived: boolean;
  /** All (date, balance) pairs the bank gave us for this account.
   *  Sorted by date ASC. Rows without a parseable date are dropped
   *  (the bank_balances table requires a date PK). The earliest
   *  entry duplicates the anchor — that's the point: it preserves
   *  the snapshot even if `accounts.startingBalance` is later
   *  manually edited. */
  balanceSeries: Array<{ date: string; balance: string }>;
}

/** Pure data transformation — easy to unit-test in isolation. The
 *  HTTP route uses this AFTER column detection and per-row
 *  normalisation; it has no I/O. */
export function groupAccountsCsv(
  rows: AccountCsvInputRow[],
): GroupedPreviewAccount[] {
  if (rows.length === 0) return [];

  // Key by lowercased name + last4. last4 is the tiebreaker when the
  // user renamed an account but the bank keeps the original name — a
  // single name match could otherwise collapse two different accounts.
  // Empty last4 still groups by name alone (Westpac's "Portfolio
  // Number" column is sometimes blank on aggregated rollup rows).
  function keyOf(r: AccountCsvInputRow): string {
    return `${r.name.toLowerCase().trim()}|${r.accountNumberLast4 ?? ""}`;
  }

  const groups = new Map<string, AccountCsvInputRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    let arr = groups.get(k);
    if (!arr) {
      arr = [];
      groups.set(k, arr);
    }
    arr.push(r);
  }

  const out: GroupedPreviewAccount[] = [];
  for (const group of groups.values()) {
    // Build the date-bearing series first — drops any rows without
    // a parsed date. ASC sort. Same-date dupes resolve to the LATER
    // value (last-write-wins): a deterministic policy for the
    // corrupt-CSV case where the bank emits two rows for the same
    // (account, date).
    const seriesByDate = new Map<string, string>();
    for (const r of group) {
      if (!r.startingDate) continue;
      seriesByDate.set(r.startingDate, r.startingBalance);
    }
    const balanceSeries = [...seriesByDate.entries()]
      .map(([date, balance]) => ({ date, balance }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Anchor = the earliest series entry. If the group has no
    // date-bearing rows at all (uncommon — a Westpac CSV with just
    // a header line and rollup totals), fall back to the first row's
    // fields so the import still produces a usable preview.
    const anchor = balanceSeries[0];
    const first = group[0];
    out.push({
      name: first.name,
      type: first.type,
      institution: first.institution,
      accountNumberLast4: first.accountNumberLast4,
      startingBalance: anchor?.balance ?? first.startingBalance,
      startingDate: anchor?.date ?? first.startingDate,
      // Same across every row in the group (account-level metadata).
      // First-row wins is fine; the user can edit before commit.
      isArchived: first.isArchived,
      balanceSeries,
    });
  }
  return out;
}
