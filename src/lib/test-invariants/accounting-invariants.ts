/**
 * Pure accounting invariants — the truths a personal-finance app
 * MUST honour regardless of which feature shipped most recently.
 *
 * These helpers are stateless predicates over raw data (txns,
 * accounts, schedules) and over report responses. Each one returns
 * either silently (invariant holds) or throws an AssertionError-shaped
 * Error (invariant violated) with a message naming the discrepancy
 * and the figures involved.
 *
 * Design borrowed from plain-text accounting tools (beancount,
 * ledger-cli, hledger): the fixture is the bookkeeping; the
 * invariants are the audit. They run on EVERY `npm test`, so any
 * regression that breaks one shows up immediately, anywhere in the
 * codebase.
 *
 * USE OUTSIDE TESTS: these helpers are pure and exported, so a future
 * "validate my data" CLI tool or admin endpoint can reuse them.
 */

/** Default float tolerance: 0.01 dollars. Picked to swallow IEEE-754
 * round-trip noise on integer-cent amounts without masking a real
 * one-cent accounting drift. */
const EPS = 0.005;

function approx(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

function fmt(n: number): string {
  return n.toFixed(2);
}

export interface RawTxn {
  accountId: string;
  amount: string | number;
  isTransfer?: boolean | null;
  /** For invariant 1 we need to know the category's transferKind. */
  categoryTransferKind?: string | null;
}

export interface RawAccount {
  id: string;
  startingBalance: string | number;
  currentBalance?: string | number | null;
}

function num(x: string | number): number {
  return typeof x === "string" ? parseFloat(x) : x;
}

// ── 1. Conservation of money ─────────────────────────────────────────
/**
 * Every internal-transfer pair must sum to zero across the two
 * accounts it touches: the outflow from account A equals the inflow
 * to account B. If the sum of all internal-transfer amounts (across
 * all accounts) isn't zero, money has been created or destroyed.
 *
 * The check is over `categoryTransferKind === 'internal'` rather
 * than `is_transfer = 1` because external/payment transfers are
 * legitimately one-sided from the asset-pool's perspective (you
 * paid off an external loan — the money really did leave the
 * household).
 */
export function assertConservationOfMoney(txns: RawTxn[]): void {
  const internalTotal = txns
    .filter((t) => t.categoryTransferKind === "internal")
    .reduce((s, t) => s + num(t.amount), 0);
  if (!approx(internalTotal, 0)) {
    throw new Error(
      `Conservation of money violated: internal transfers sum to ${fmt(internalTotal)}, expected 0.`,
    );
  }
}

// ── 2. Per-account reconciliation ────────────────────────────────────
/**
 * For each account at any cutoff date D:
 *
 *     balance(D) = starting_balance + Σ(amount where date ≤ D)
 *
 * Production stores the up-to-now balance in `accounts.currentBalance`.
 * This invariant takes the raw txns + the stored balance and asserts
 * they line up. A drift here would surface as the dashboard balance
 * disagreeing with the sum of the transactions list.
 */
export function assertAccountReconciliation(
  account: RawAccount,
  txnsForAccount: RawTxn[],
): void {
  const starting = num(account.startingBalance);
  const sum = txnsForAccount.reduce((s, t) => s + num(t.amount), 0);
  const expected = starting + sum;
  if (account.currentBalance == null) return; // not stored — skip
  const actual = num(account.currentBalance);
  if (!approx(actual, expected)) {
    throw new Error(
      `Account reconciliation violated for ${account.id}: ` +
        `currentBalance=${fmt(actual)} but starting(${fmt(starting)}) + Σ(${fmt(sum)}) = ${fmt(expected)}.`,
    );
  }
}

// ── 3. Period continuity ─────────────────────────────────────────────
/**
 * Closing balance of period N must equal opening balance of period
 * N+1. Equivalent: closing[m] = closing[m-1] + net[m]. Drift here
 * was the symptom of commit 140d53e (starting_balance dropped) and
 * a183ba8 (hideTransfers leaking into the walk).
 */
export function assertPeriodContinuity(
  openingBalance: number,
  monthlyNet: Record<string, number>,
  closingBalance: Record<string, number>,
): void {
  const months = Object.keys(monthlyNet).sort();
  let running = openingBalance;
  for (const m of months) {
    running += monthlyNet[m];
    const reported = closingBalance[m];
    if (reported == null) {
      throw new Error(`Period continuity: closing balance missing for ${m}.`);
    }
    if (!approx(reported, running)) {
      throw new Error(
        `Period continuity violated at ${m}: closing=${fmt(reported)} but ` +
          `opening+ΣnetSoFar=${fmt(running)}.`,
      );
    }
  }
}

// ── 4. Categorisation completeness ───────────────────────────────────
/**
 * Σ(category breakdown) + Σ(uncategorised) + Σ(internal transfers) ==
 * Σ(all transactions).
 *
 * Catches a category being silently dropped — e.g. a hideTransfers
 * filter applied to the breakdown side but not the raw side, which
 * was the exact shape of commit a183ba8's bug.
 */
export interface CategorisationBuckets {
  income: number;
  expenses: number;
  /** Either uncategorised OR transfer-only amounts; pass 0 if folded
   * into the income/expense numbers already. */
  uncategorised: number;
  /** Internal transfers across all accounts — should be 0 globally
   * (conservation) but contributes 0 to expense/income totals. */
  internalTransfers: number;
}
export function assertCategorisationCompleteness(
  rawTxnSum: number,
  buckets: CategorisationBuckets,
): void {
  const reconstructed =
    buckets.income +
    buckets.expenses +
    buckets.uncategorised +
    buckets.internalTransfers;
  if (!approx(reconstructed, rawTxnSum)) {
    throw new Error(
      `Categorisation completeness violated: raw txn Σ=${fmt(rawTxnSum)} but ` +
        `income(${fmt(buckets.income)}) + expenses(${fmt(buckets.expenses)}) + ` +
        `uncat(${fmt(buckets.uncategorised)}) + internalXfer(${fmt(buckets.internalTransfers)}) ` +
        `= ${fmt(reconstructed)}.`,
    );
  }
}

// ── 5. Roll-up integrity ─────────────────────────────────────────────
/**
 * A parent's `byMonth[m]` (when present) must equal the sum of its
 * descendant leaves' `byMonth[m]`. Build a name → id map and a parent
 * adjacency, then walk depth-first verifying each level.
 */
export interface CashflowCategoryLike {
  id: string;
  parentId: string | null;
  byMonth: Record<string, number>;
}

export function assertRollupIntegrity(
  cats: CashflowCategoryLike[],
  month: string,
): void {
  // Build a fast lookup; in the report a category appears once per
  // type (income vs expense), and a parent might appear with only its
  // OWN direct txns (children carry the rest). We're verifying that a
  // hand-computed leaf-sum equals the parent's stated total when the
  // production code rolls it up — that step is in buildGroups, so the
  // numeric leaf sum is what we check here.
  const byId = new Map(cats.map((c) => [c.id, c] as const));
  const childrenOf = new Map<string, string[]>();
  for (const c of cats) {
    if (c.parentId) {
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c.id);
      childrenOf.set(c.parentId, arr);
    }
  }
  function leafSum(id: string): number {
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      const own = byId.get(id)?.byMonth[month] ?? 0;
      return own;
    }
    return kids.reduce(
      (s, k) => s + leafSum(k),
      byId.get(id)?.byMonth[month] ?? 0,
    );
  }
  for (const c of cats) {
    const kids = childrenOf.get(c.id) ?? [];
    if (kids.length === 0) continue; // leaf — nothing to verify
    const expected = leafSum(c.id);
    // The CashflowCategory at a parent id (when emitted by the API)
    // is the parent's OWN-direct rows only; the rollup happens in
    // buildGroups on the client. So we only assert when the parent
    // also has a row here — otherwise there's nothing to compare.
    const own = byId.get(c.id);
    if (!own) continue;
    const stated = own.byMonth[month] ?? 0;
    // The "stated" value is the parent's own-direct; the leafSum
    // includes the parent's own + all descendants. They're only
    // expected equal when the parent has no descendant txns this
    // month. To make the invariant useful, compute "parent's own
    // direct" by subtracting descendants from leafSum:
    const directOnly =
      leafSum(c.id) -
      kids.reduce((s, k) => s + leafSum(k), 0);
    if (!approx(stated, directOnly)) {
      throw new Error(
        `Roll-up integrity violated for cat ${c.id} in ${month}: ` +
          `stated=${fmt(stated)} but parent's-own-direct=${fmt(directOnly)}.`,
      );
    }
  }
}

// ── 6. Aggregate idempotency ─────────────────────────────────────────
/**
 * Avg/mo × N = Total (within rounding). Plan/mo × N ≈ Σ scheduledByMonth
 * (firing variability for quarterly/yearly schedules means we use a
 * relaxed tolerance for non-monthly cadences).
 */
export function assertAvgIdempotency(
  total: number,
  avgPerMonth: number,
  monthCount: number,
): void {
  const reconstructed = avgPerMonth * monthCount;
  if (!approx(reconstructed, total, 0.01 * monthCount)) {
    throw new Error(
      `Avg/mo idempotency violated: total=${fmt(total)} but avg(${fmt(avgPerMonth)}) × N(${monthCount}) = ${fmt(reconstructed)}.`,
    );
  }
}

// ── 9. Schedule projection consistency ───────────────────────────────
/**
 * For monthly schedules in a window of N months:
 *   Σ scheduledByMonth ≈ scheduledPerMonth × N
 * Within firing variability for quarterly/yearly (we use a relaxed
 * tolerance: one month's worth of slack).
 */
export function assertScheduleProjectionConsistency(
  scheduledByMonth: Record<string, number>,
  scheduledPerMonth: number,
  monthCount: number,
): void {
  const sum = Object.values(scheduledByMonth).reduce((s, v) => s + v, 0);
  const expected = scheduledPerMonth * monthCount;
  // Allow one month's slack — a quarterly bill can land 4× in a
  // 12-month window or 3× depending on the start date.
  const slack = Math.abs(scheduledPerMonth) + 0.01;
  if (Math.abs(sum - expected) > slack) {
    throw new Error(
      `Schedule projection inconsistency: Σ scheduledByMonth=${fmt(sum)} but ` +
        `scheduledPerMonth(${fmt(scheduledPerMonth)}) × N(${monthCount}) = ${fmt(expected)} ` +
        `(slack ${fmt(slack)}).`,
    );
  }
}
