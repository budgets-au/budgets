/** Pure builders for the sample dataset seeded on a fresh DB.
 *
 * The seeder in `src/db/index.ts` calls `buildSampleData(...)` once
 * — when both `app_settings.sample_data_seeded` is 0 AND the DB has
 * no user data yet — then writes the result via drizzle. Everything
 * here is pure: same `today` + same category lookups → same output,
 * which is what the unit tests rely on.
 *
 * Date arithmetic uses local components on purpose. The rest of the
 * app (`src/lib/recurrence.ts` `toISO`) does the same; UTC-formatting
 * would roll AEST mornings to "yesterday" and off-by-one the demo. */

export interface SampleAccountRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  startingBalance: string;
  currentBalance: string;
  startingDate: string;
  color: string;
  isExternal: boolean;
  isSample: boolean;
}

export interface SampleTransactionRow {
  id: string;
  accountId: string;
  date: string;
  amount: string;
  payee: string;
  description: string | null;
  categoryId: string | null;
  isTransfer: boolean;
  transferPairId: string | null;
  isReconciled: boolean;
  type: string;
  isSample: boolean;
}

export interface SampleScheduleRow {
  id: string;
  kind: string;
  accountId: string;
  payee: string;
  amount: string;
  type: string;
  categoryId: string | null;
  transferToAccountId: string | null;
  frequency: string;
  interval: number;
  startDate: string;
  isActive: boolean;
  lineageId: string;
  isSample: boolean;
}

export interface SampleDataPayload {
  accounts: SampleAccountRow[];
  transactions: SampleTransactionRow[];
  schedules: SampleScheduleRow[];
}

const newId = () => crypto.randomUUID();

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

interface TxnTemplate {
  daysAgo: number;
  account: "checking" | "savings";
  category: string; // matches a name in DEFAULT_CATEGORIES
  payee: string;
  amount: number;
}

/** ~21 transactions spanning the last 8 weeks — enough to populate the
 * dashboard, the cashflow projection, and the categories pie without
 * cluttering the list. Two transfer pairs (4 rows) added separately
 * below, so the total seeded is 25 transactions. */
const TX_TEMPLATES: readonly TxnTemplate[] = [
  // last week
  { daysAgo: 0, account: "checking", category: "Groceries", payee: "Coles Eastwood", amount: -78.40 },
  { daysAgo: 1, account: "checking", category: "Dining Out", payee: "Bear & Bok", amount: -42.00 },
  { daysAgo: 2, account: "checking", category: "Fuel", payee: "Ampol Hornsby", amount: -68.20 },
  { daysAgo: 3, account: "checking", category: "Salary", payee: "Acme Corp Payroll", amount: 3500.00 },
  { daysAgo: 5, account: "checking", category: "Groceries", payee: "Aldi Eastwood", amount: -54.10 },
  { daysAgo: 6, account: "checking", category: "Dining Out", payee: "Sakura Sushi", amount: -36.50 },
  // 1-2 weeks ago
  { daysAgo: 10, account: "checking", category: "Utilities", payee: "AGL Electricity", amount: -185.30 },
  { daysAgo: 12, account: "checking", category: "Groceries", payee: "Woolworths Eastwood", amount: -110.20 },
  { daysAgo: 13, account: "checking", category: "Subscriptions", payee: "Spotify Premium", amount: -14.99 },
  { daysAgo: 14, account: "checking", category: "Rent / Mortgage", payee: "Realestate Property Mgmt", amount: -2200.00 },
  // 2-3 weeks ago
  { daysAgo: 17, account: "checking", category: "Salary", payee: "Acme Corp Payroll", amount: 3500.00 },
  { daysAgo: 19, account: "checking", category: "Fuel", payee: "BP Carlingford", amount: -71.00 },
  { daysAgo: 21, account: "checking", category: "Groceries", payee: "Coles Eastwood", amount: -88.65 },
  { daysAgo: 23, account: "checking", category: "Dining Out", payee: "Pizzeria Roma", amount: -52.00 },
  // 4-5 weeks ago
  { daysAgo: 28, account: "checking", category: "Utilities", payee: "Aussie Broadband", amount: -89.00 },
  { daysAgo: 30, account: "checking", category: "Groceries", payee: "Woolworths Eastwood", amount: -94.30 },
  { daysAgo: 31, account: "checking", category: "Salary", payee: "Acme Corp Payroll", amount: 3500.00 },
  // 5-6 weeks ago
  { daysAgo: 35, account: "checking", category: "Groceries", payee: "Aldi Eastwood", amount: -62.20 },
  { daysAgo: 38, account: "checking", category: "Fuel", payee: "Ampol Hornsby", amount: -65.80 },
  // 6-7 weeks ago
  { daysAgo: 42, account: "checking", category: "Groceries", payee: "Coles Eastwood", amount: -101.50 },
  { daysAgo: 45, account: "checking", category: "Salary", payee: "Acme Corp Payroll", amount: 3500.00 },
];

/** Two manual transfers from checking → savings, on day 7 and day 35
 * back. Each event is a *pair* of transactions linked via
 * `transferPairId`. */
const TRANSFER_DAYS_AGO: readonly number[] = [7, 35];

export interface BuildSampleDataOptions {
  /** Anchor for date math. The seeder passes `new Date()`; tests pass
   * a fixed date so output stays deterministic. */
  today: Date;
  /** category name → id map. Sample-data builders look up category
   * names from DEFAULT_CATEGORIES; if a name is missing the row's
   * categoryId is null and the transaction shows up uncategorised. */
  categoryIdsByName: Map<string, string>;
  /** Optional pre-allocated account IDs — useful in tests where the
   * caller wants stable IDs to assert against. Defaults to fresh
   * UUIDs. */
  accountIds?: { checking?: string; savings?: string };
}

export function buildSampleData(opts: BuildSampleDataOptions): SampleDataPayload {
  const { today, categoryIdsByName } = opts;
  const checkingId = opts.accountIds?.checking ?? newId();
  const savingsId = opts.accountIds?.savings ?? newId();
  const startingDate = toISO(shiftDays(today, -56));

  const accounts: SampleAccountRow[] = [
    {
      id: checkingId,
      name: "Everyday Checking",
      type: "checking",
      currency: "AUD",
      startingBalance: "4820.00",
      currentBalance: "4820.00",
      startingDate,
      color: "#3b82f6",
      isExternal: false,
      isSample: true,
    },
    {
      id: savingsId,
      name: "High Interest Savings",
      type: "savings",
      currency: "AUD",
      startingBalance: "12000.00",
      currentBalance: "12000.00",
      startingDate,
      color: "#10b981",
      isExternal: true,
      isSample: true,
    },
  ];

  const transactions: SampleTransactionRow[] = [];

  for (const t of TX_TEMPLATES) {
    const accountId = t.account === "checking" ? checkingId : savingsId;
    const categoryId = categoryIdsByName.get(t.category) ?? null;
    transactions.push({
      id: newId(),
      accountId,
      date: toISO(shiftDays(today, -t.daysAgo)),
      amount: t.amount.toFixed(2),
      payee: t.payee,
      description: null,
      categoryId,
      isTransfer: false,
      transferPairId: null,
      isReconciled: false,
      type: t.amount >= 0 ? "income" : "expense",
      isSample: true,
    });
  }

  const transferCategoryId = categoryIdsByName.get("Transfer") ?? null;
  for (const daysAgo of TRANSFER_DAYS_AGO) {
    const fromId = newId();
    const toId = newId();
    const date = toISO(shiftDays(today, -daysAgo));
    transactions.push(
      {
        id: fromId,
        accountId: checkingId,
        date,
        amount: "-500.00",
        payee: "Transfer to Savings",
        description: null,
        categoryId: transferCategoryId,
        isTransfer: true,
        transferPairId: toId,
        isReconciled: false,
        type: "transfer",
        isSample: true,
      },
      {
        id: toId,
        accountId: savingsId,
        date,
        amount: "500.00",
        payee: "Transfer from Checking",
        description: null,
        categoryId: transferCategoryId,
        isTransfer: true,
        transferPairId: fromId,
        isReconciled: false,
        type: "transfer",
        isSample: true,
      },
    );
  }

  // Refresh currentBalance from the actual transaction sum so the
  // dashboard tile and the transactions list agree on day one.
  for (const acc of accounts) {
    const sum = transactions
      .filter((t) => t.accountId === acc.id)
      .reduce((s, t) => s + parseFloat(t.amount), 0);
    acc.currentBalance = (parseFloat(acc.startingBalance) + sum).toFixed(2);
  }

  // Three schedules positioned slightly in the future so the cashflow
  // projection has something to project, the calendar has markers,
  // and the missed-occurrence detector doesn't immediately flag them.
  const fortnightAhead = toISO(shiftDays(today, 14));
  const schedules: SampleScheduleRow[] = [
    {
      id: newId(),
      kind: "schedule",
      accountId: checkingId,
      payee: "Realestate Property Mgmt",
      amount: "-2200.00",
      type: "expense",
      categoryId: categoryIdsByName.get("Rent / Mortgage") ?? null,
      transferToAccountId: null,
      frequency: "monthly",
      interval: 1,
      startDate: fortnightAhead,
      isActive: true,
      lineageId: newId(),
      isSample: true,
    },
    {
      id: newId(),
      kind: "schedule",
      accountId: checkingId,
      payee: "Acme Corp Payroll",
      amount: "3500.00",
      type: "income",
      categoryId: categoryIdsByName.get("Salary") ?? null,
      transferToAccountId: null,
      frequency: "fortnightly",
      interval: 1,
      startDate: fortnightAhead,
      isActive: true,
      lineageId: newId(),
      isSample: true,
    },
    {
      id: newId(),
      kind: "schedule",
      accountId: checkingId,
      payee: "Transfer to Savings",
      amount: "-500.00",
      type: "transfer",
      categoryId: categoryIdsByName.get("Transfer") ?? null,
      transferToAccountId: savingsId,
      frequency: "monthly",
      interval: 1,
      startDate: fortnightAhead,
      isActive: true,
      lineageId: newId(),
      isSample: true,
    },
  ];

  return { accounts, transactions, schedules };
}

/** Counts of seeded rows — exposed so tests / integration checks can
 * compare against the actual table contents after a seed. */
export const SAMPLE_DATA_COUNTS = {
  accounts: 2,
  transactions: TX_TEMPLATES.length + TRANSFER_DAYS_AGO.length * 2,
  schedules: 3,
} as const;
