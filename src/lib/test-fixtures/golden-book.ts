/**
 * The Golden Book — a single deterministic personal-finance fixture
 * that every accounting integration test seeds into an in-memory DB.
 *
 * Design intent:
 *   - Multi-account (asset + liability variety) so transfers exercise
 *     real per-account math, not just an all-account net of zero.
 *   - Three-level category tree so parent/grandparent rollups are
 *     covered.
 *   - A SCHEDULE SUPERSESSION (Health Insurance $547 Jan–Jun → $580
 *     Jul–Dec) — the exact shape behind commit 9a2c47b's Plan/mo
 *     double-counting bug.
 *   - At least one refund (positive amount on an expense category) so
 *     sign-convention paper-overs would surface.
 *   - At least one uncategorised txn so "completeness" invariant has
 *     something to find.
 *   - Internal transfer category so the transfer-netting invariant has
 *     something to verify.
 *
 * Every number flowing out of the fixture is hand-computed in
 * `golden-book-truth.ts` so the test assertions don't have to
 * re-derive what the production code is supposed to compute.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  accounts,
  categories,
  scheduledTransactions,
  transactions,
} from "@/db/schema";
import * as schema from "@/db/schema";

type Db = BetterSQLite3Database<typeof schema>;

/** The fixture's reference window. Every transaction date sits inside
 * this range; the cashflow report is exercised at exactly this span. */
export const GOLDEN_FROM = "2026-01-01";
export const GOLDEN_TO = "2026-12-31";
export const GOLDEN_MONTHS = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
] as const;

// Stable IDs — referenced by truth-table constants too, so changes
// here must move in lock-step with the expected numbers.
export const ACC = {
  cheque: "acc-cheque",
  savings: "acc-savings",
} as const;

export const CAT = {
  income: "cat-income",
  salary: "cat-salary",
  expenses: "cat-expenses",
  food: "cat-food",
  groceries: "cat-groceries",
  insurance: "cat-insurance",
  health: "cat-health",
  internalTransfer: "cat-xfer-internal",
} as const;

export const SCHED = {
  salary: "sch-salary",
  healthV1: "sch-health-v1",
  healthV2: "sch-health-v2",
  groceries: "sch-groceries",
  internalTransfer: "sch-xfer-internal",
} as const;

/** Lineage for the Health Insurance supersession. Both V1 and V2 share
 * this so the report's lineage-aware projection treats them as one
 * "stream" with two amounts. */
const LINEAGE_HEALTH = "lineage-health";

/** Last day of `yyyy-mm` (handles month-length without date-fns). */
function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function dayOf(month: string, day: number): string {
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Seed every account, category, schedule, and transaction. Idempotent
 * on a fresh DB — call once in beforeAll. */
export function seedGoldenBook(db: Db): void {
  // ── Accounts ────────────────────────────────────────────────────
  db.insert(accounts).values([
    {
      id: ACC.cheque,
      name: "Cheque",
      type: "checking",
      currentBalance: "0", // recomputed below; not the source of truth
      startingBalance: "5000",
      startingDate: "2025-12-31",
    },
    {
      id: ACC.savings,
      name: "Savings",
      type: "savings",
      currentBalance: "0",
      startingBalance: "50000",
      startingDate: "2025-12-31",
    },
  ]).run();

  // ── Categories (3 levels) ───────────────────────────────────────
  db.insert(categories).values([
    { id: CAT.income, name: "Income", type: "income", transferKind: "none" },
    {
      id: CAT.salary,
      name: "Salary",
      type: "income",
      transferKind: "none",
      parentId: CAT.income,
    },
    { id: CAT.expenses, name: "Expenses", type: "expense", transferKind: "none" },
    {
      id: CAT.food,
      name: "Food",
      type: "expense",
      transferKind: "none",
      parentId: CAT.expenses,
    },
    {
      id: CAT.groceries,
      name: "Groceries",
      type: "expense",
      transferKind: "none",
      parentId: CAT.food,
    },
    {
      id: CAT.insurance,
      name: "Insurance",
      type: "expense",
      transferKind: "none",
      parentId: CAT.expenses,
    },
    {
      id: CAT.health,
      name: "Health",
      type: "expense",
      transferKind: "none",
      parentId: CAT.insurance,
    },
    {
      id: CAT.internalTransfer,
      name: "Internal Transfer",
      type: "expense",
      transferKind: "internal",
    },
  ]).run();

  // ── Schedules ───────────────────────────────────────────────────
  // Salary monthly $6000 → Cheque (income)
  db.insert(scheduledTransactions).values({
    id: SCHED.salary,
    kind: "schedule",
    accountId: ACC.cheque,
    amount: "6000",
    type: "income",
    categoryId: CAT.salary,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-01-01",
    dayOfMonth: 1,
    isActive: true,
    lineageId: "lineage-salary",
  }).run();

  // Health V1 (Jan–Jun) — superseded predecessor: isActive=false +
  // endDate set. Exercises the "include past occurrences" path AND
  // the Plan/mo-doesn't-double-count fix.
  db.insert(scheduledTransactions).values({
    id: SCHED.healthV1,
    kind: "schedule",
    accountId: ACC.cheque,
    amount: "547",
    type: "expense",
    categoryId: CAT.health,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-01-01",
    endDate: "2026-06-30",
    dayOfMonth: 15,
    isActive: false,
    lineageId: LINEAGE_HEALTH,
  }).run();

  // Health V2 (Jul–Dec) — current active schedule in the same lineage.
  db.insert(scheduledTransactions).values({
    id: SCHED.healthV2,
    kind: "schedule",
    accountId: ACC.cheque,
    amount: "580",
    type: "expense",
    categoryId: CAT.health,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-07-01",
    dayOfMonth: 15,
    isActive: true,
    lineageId: LINEAGE_HEALTH,
  }).run();

  // Groceries monthly $800 → Cheque
  db.insert(scheduledTransactions).values({
    id: SCHED.groceries,
    kind: "schedule",
    accountId: ACC.cheque,
    amount: "800",
    type: "expense",
    categoryId: CAT.groceries,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-01-01",
    dayOfMonth: 20,
    isActive: true,
    lineageId: "lineage-groceries",
  }).run();

  // Internal transfer monthly $1000 Cheque → Savings
  db.insert(scheduledTransactions).values({
    id: SCHED.internalTransfer,
    kind: "schedule",
    accountId: ACC.cheque,
    amount: "1000",
    type: "transfer",
    categoryId: CAT.internalTransfer,
    transferToAccountId: ACC.savings,
    frequency: "monthly",
    interval: 1,
    startDate: "2026-01-01",
    dayOfMonth: 25,
    isActive: true,
    lineageId: "lineage-xfer",
  }).run();

  // ── Transactions (matching the schedules) ───────────────────────
  // Generated month-by-month so a missing assertion clearly points at
  // the offending fixture row.
  const txns: (typeof transactions.$inferInsert)[] = [];
  for (let mi = 0; mi < GOLDEN_MONTHS.length; mi++) {
    const m = GOLDEN_MONTHS[mi];
    // Salary on the 1st (always last day of prior month for end-of-Dec,
    // but here every month is paid on its 1st for simplicity).
    txns.push({
      id: `txn-salary-${m}`,
      accountId: ACC.cheque,
      date: dayOf(m, 1),
      amount: "6000",
      categoryId: CAT.salary,
      payee: "Employer Pty Ltd",
    });
    // Health: $547 Jan–Jun, $580 Jul–Dec — same category, two amounts.
    const healthAmount = mi < 6 ? "-547" : "-580";
    txns.push({
      id: `txn-health-${m}`,
      accountId: ACC.cheque,
      date: dayOf(m, 15),
      amount: healthAmount,
      categoryId: CAT.health,
      payee: "Health Cover",
    });
    // Groceries: -$800 every 20th.
    txns.push({
      id: `txn-groceries-${m}`,
      accountId: ACC.cheque,
      date: dayOf(m, 20),
      amount: "-800",
      categoryId: CAT.groceries,
      payee: "Supermarket",
    });
    // Internal transfer pair on the 25th: -1000 Cheque, +1000 Savings.
    // Both flagged is_transfer=1 + categorised under Internal Transfer
    // (transfer_kind=internal). transferPairId links them.
    const xferOutId = `txn-xfer-out-${m}`;
    const xferInId = `txn-xfer-in-${m}`;
    txns.push({
      id: xferOutId,
      accountId: ACC.cheque,
      date: dayOf(m, 25),
      amount: "-1000",
      categoryId: CAT.internalTransfer,
      isTransfer: true,
      transferPairId: xferInId,
      payee: "Internal transfer",
    });
    txns.push({
      id: xferInId,
      accountId: ACC.savings,
      date: dayOf(m, 25),
      amount: "1000",
      categoryId: CAT.internalTransfer,
      isTransfer: true,
      transferPairId: xferOutId,
      payee: "Internal transfer",
    });
  }
  // Special-case March: a $25 grocery refund + a $50 uncategorised
  // outflow. Forces the suite to handle sign-exception expenses and
  // the no-category case without paper-overs.
  txns.push({
    id: "txn-grocery-refund-2026-03",
    accountId: ACC.cheque,
    date: "2026-03-10",
    amount: "25",
    categoryId: CAT.groceries,
    payee: "Supermarket refund",
  });
  txns.push({
    id: "txn-uncat-2026-03",
    accountId: ACC.cheque,
    date: "2026-03-12",
    amount: "-50",
    categoryId: null,
    payee: "Mystery merchant",
  });

  // SQLite's transferPairId FK is self-referential; insert with FK
  // deferred so each pair lands atomically. Mirrors the
  // `seedSampleDataIfMissing` pattern in src/db/index.ts.
  db.transaction((tx) => {
    // The FK check needs to relax during the bulk insert because each
    // transfer row references its partner by id. `defer_foreign_keys`
    // pushes FK checking out to COMMIT so the pair lands atomically.
    const raw = db as unknown as {
      $client: { pragma: (s: string) => void };
    };
    raw.$client.pragma("defer_foreign_keys = 1");
    tx.insert(transactions).values(txns).run();
  });

  // Update each account's currentBalance to mirror what the live app
  // does — starting_balance + Σ(amount). Some routes (account list)
  // read this column directly, so seeding it ensures the test mirrors
  // production behaviour.
  for (const accId of [ACC.cheque, ACC.savings]) {
    const sumRow = db
      .select({ id: accounts.id, starting: accounts.startingBalance })
      .from(accounts)
      .where(eq(accounts.id, accId))
      .all()[0];
    const all = db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(eq(transactions.accountId, accId))
      .all();
    const sum = all.reduce((s, r) => s + parseFloat(r.amount), 0);
    const balance = parseFloat(sumRow.starting) + sum;
    db.update(accounts)
      .set({ currentBalance: String(balance) })
      .where(eq(accounts.id, accId))
      .run();
  }
}
