import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  primaryKey,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────
//
// SQLite doesn't have a native UUID type or a `gen_random_uuid()` default —
// IDs are generated app-side via $defaultFn so existing app behaviour
// (UUID-shaped primary keys) is preserved without an INSERT-site change.
//
// Numeric columns are stored as TEXT to preserve the parseFloat/toFixed(2)
// shape the rest of the app relies on. The previous Postgres schema used
// `numeric(p,s)` which postgres-js also returned as strings, so call sites
// don't change.
//
// Timestamps are stored as integer milliseconds for fast comparison/
// sorting; Drizzle hides the conversion behind native Date objects.
const newUuid = () => crypto.randomUUID();

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = sqliteTable("users", {
  id: text("id").primaryKey().$defaultFn(newUuid),
  name: text("name").notNull(),
  // Login identifier. Plain text — no email semantics, no unicode
  // shenanigans, just a printable handle. Legacy column was `email`
  // (renamed in migration 0003).
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("member"), // admin | member
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    name: text("name").notNull(),
    type: text("type").notNull(), // checking | savings | credit | loan | cash
    institution: text("institution"),
    accountNumberLast4: text("account_number_last4"),
    currency: text("currency").notNull().default("AUD"),
    currentBalance: text("current_balance").notNull().default("0"),
    startingBalance: text("starting_balance").notNull().default("0"),
    startingDate: text("starting_date"),
    color: text("color").notNull().default("#6366f1"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Opt-out of the asset-pool internal-transfer netting. When true, any
     * transfer touching this account counts as real cashflow regardless of
     * whether both legs are asset types. Set on Savings, Emergency, and
     * other "money set aside" buckets so paying into them shows up in the
     * weekly total instead of silently netting to zero. */
    isExternal: integer("is_external", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Flag for the demo dataset seeded into a fresh DB. The "Remove
     * sample data" control in Settings deletes every row tagged
     * isSample=1 across accounts / transactions / scheduled. User-
     * created rows are always isSample=0. */
    isSample: integer("is_sample", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("accounts_archived_idx").on(t.isArchived)],
);

/** Bank-supplied identifiers that map to one of our accounts. Multi-account
 * imports (Westpac CSV's "Bank Account" column, QIF !Account names, OFX
 * ACCTID) consult this table so each transaction routes to the right
 * account without re-asking the user every import. */
export const accountAliases = sqliteTable(
  "account_aliases",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** Discriminator: 'bank-account' for plain account-number aliases,
     * 'ofx-acctid' for OFX-specific identifiers, etc. */
    aliasKind: text("alias_kind").notNull(),
    aliasValue: text("alias_value").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("account_aliases_kind_value_unique").on(
      t.aliasKind,
      t.aliasValue,
    ),
    index("account_aliases_account_idx").on(t.accountId),
  ],
);

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    name: text("name").notNull(),
    type: text("type").notNull(), // income | expense
    color: text("color").notNull().default("#94a3b8"),
    parentId: text("parent_id").references((): AnySQLiteColumn => categories.id, {
      onDelete: "cascade",
    }),
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    // Transfer semantics (single enum replacing the legacy is_transfer +
    // is_payment booleans — see drizzle/0005_transfer_kind.sql):
    //   'none'     — regular income/expense category.
    //   'internal' — pure asset-to-asset move (Checking → Savings); excluded
    //                from cashflow & report rollups, balance-only.
    //   'external' — payment to an UNTRACKED debt (external CC / loan);
    //                counted as an expense in cashflow.
    transferKind: text("transfer_kind", {
      enum: ["none", "internal", "external"],
    })
      .notNull()
      .default("none"),
    // Manual ordering within a (type, parent_id) sibling group. Lower =
    // earlier. Backfilled from alphabetical order in the historical
    // Postgres migration 0029.
    sortOrder: integer("sort_order").notNull().default(9999),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("categories_name_type_parent_idx").on(
      t.name,
      t.type,
      t.parentId,
    ),
    index("categories_sort_idx").on(t.type, t.parentId, t.sortOrder),
  ],
);

// ─── Import Logs ──────────────────────────────────────────────────────────────

export const importLogs = sqliteTable("import_logs", {
  id: text("id").primaryKey().$defaultFn(newUuid),
  accountId: text("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  filename: text("filename").notNull(),
  format: text("format").notNull(), // csv | ofx | qfx | qif
  institution: text("institution"),
  accountNumber: text("account_number"),
  rowsParsed: integer("rows_parsed").notNull().default(0),
  rowsImported: integer("rows_imported").notNull().default(0),
  rowsSkipped: integer("rows_skipped").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | committed | failed
  errorMessage: text("error_message"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  committedAt: integer("committed_at", { mode: "timestamp_ms" }),
});

// ─── Transactions ─────────────────────────────────────────────────────────────

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    amount: text("amount").notNull(),
    payee: text("payee"),
    /** Cached normalisePayee(payee) result — date/ID/code-stripped + upper.
     * Searched by the JS trigram suggester (lib/trigram.ts) when
     * suggesting categories for new imports. */
    normalizedPayee: text("normalized_payee"),
    /** Match form of normalized_payee with per-transaction reference IDs
     * dropped (e.g. HCFHEALTH 035353568S91WCCJY6 → HCFHEALTH). Tokens
     * that look like reference codes (length ≥ 8, mixed letters+digits)
     * AND appear only once across the whole corpus are stripped, so
     * stable identifiers (policy numbers, account refs) survive while
     * per-row noise is dropped. The trigram suggester searches against
     * this column. */
    matchPayee: text("match_payee"),
    description: text("description"),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    isTransfer: integer("is_transfer", { mode: "boolean" })
      .notNull()
      .default(false),
    transferPairId: text("transfer_pair_id").references(
      (): AnySQLiteColumn => transactions.id,
      { onDelete: "set null" },
    ),
    /** Synthetic-leg marker. TRUE only on rows the app minted itself
     * to stand in for the OTHER leg of a transfer whose real
     * counterpart lives in an untracked account. Auto-cleared when
     * a CSV import promotes the row in place (commit-batched
     * reconciliation pass). See drizzle/0009_transactions_is_synthetic.sql. */
    isSynthetic: integer("is_synthetic", { mode: "boolean" })
      .notNull()
      .default(false),
    isReconciled: integer("is_reconciled", { mode: "boolean" })
      .notNull()
      .default(false),
    importLogId: text("import_log_id").references(() => importLogs.id, {
      onDelete: "set null",
    }),
    importHash: text("import_hash").unique(),
    rawFitid: text("raw_fitid"),
    /** Bank-supplied transaction type/category captured at import — OFX
     * TRNTYPE (DEBIT/CREDIT/INT/FEE/etc.), QIF L field, or CSV
     * Categories/Type column. Verbatim hint, no enum constraint. */
    type: text("type"),
    /** Post-transaction running balance from the bank's CSV "Balance"
     * column. Useful for reconciliation and balance-gap detection.
     * Nullable — OFX/QIF rarely emit a per-transaction balance. */
    balance: text("balance"),
    /** Full DTPOSTED timestamp captured from OFX imports — used to recover
     * the bank's intra-day ordering. Null for CSV/QIF imports and for rows
     * imported before this column existed. */
    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    /** File-position of the row in the imported batch. Used as a tiebreaker
     * when postedAt is missing or all rows on a day share the same time. */
    postedSeq: integer("posted_seq"),
    /** See accounts.isSample — same flag, removed in bulk via the
     * Settings panel. */
    isSample: integer("is_sample", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("transactions_account_idx").on(t.accountId),
    index("transactions_date_idx").on(t.date),
    index("transactions_category_idx").on(t.categoryId),
    index("transactions_normalized_payee_idx").on(t.normalizedPayee),
    index("transactions_match_payee_idx").on(t.matchPayee),
    // Covers the hot /api/transactions filter shape: scope by account
    // then bound by date. The single-column accountId / date indexes
    // each force a sort or filter pass; this composite lets SQLite
    // seek both bounds in one pass.
    index("transactions_account_date_idx").on(t.accountId, t.date),
    // Composite that prunes the transfer-matcher self-join to just the
    // unpaired (`transfer_pair_id IS NULL`) rows in the relevant date
    // window. Without it, `pairTransfersInWindow()` scans the whole
    // transactions table on both sides of the join.
    index("transactions_transfer_pair_date_idx").on(
      t.transferPairId,
      t.date,
    ),
  ],
);

// ─── Scheduled Transactions ───────────────────────────────────────────────────

export const scheduledTransactions = sqliteTable(
  "scheduled_transactions",
  {
  id: text("id").primaryKey().$defaultFn(newUuid),
  // 'schedule' = single recurring occurrence (the original kind, matched
  // 1-to-1 against real transactions); 'budget' = per-period spending cap
  // aggregated across the category subtree (no per-occurrence matching).
  kind: text("kind").notNull().default("schedule"),
  // Nullable: budget rows may apply across all accounts.
  accountId: text("account_id").references(() => accounts.id, {
    onDelete: "cascade",
  }),
  payee: text("payee"),
  description: text("description"),
  amount: text("amount").notNull(),
  // Optional lower bound for variable-amount schedules (utilities, energy
  // bills, etc.). NULL → single-amount mode (matching uses ±$0.01 tolerance,
  // forecasting uses `amount`). When set, matching accepts transactions whose
  // magnitude falls within [amountMin, |amount|]; forecasting always uses
  // `amount` (the max).
  amountMin: text("amount_min"),
  type: text("type").notNull(), // income | expense | transfer
  categoryId: text("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  transferToAccountId: text("transfer_to_account_id").references(
    () => accounts.id,
    { onDelete: "set null" },
  ),
  frequency: text("frequency").notNull(), // once|daily|weekly|fortnightly|monthly|quarterly|yearly
  interval: integer("interval").notNull().default(1),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  dayOfMonth: integer("day_of_month"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  // Chain identifier. All schedules sharing the same lineage represent one
  // logical recurring payment whose amount or terms have changed over time.
  // Set to a fresh UUID by default; successors created via the "replace"
  // flow inherit their predecessor's lineageId.
  lineageId: text("lineage_id").notNull().$defaultFn(newUuid),
  /** See accounts.isSample. */
  isSample: integer("is_sample", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  },
  (t) => [
    // Hot filter for the dashboard upcoming-schedules query + several
    // reports; the table is small today but the filter runs on every
    // dashboard load.
    index("scheduled_transactions_is_active_idx").on(t.isActive),
  ],
);

// ─── Budgets ──────────────────────────────────────────────────────────────────

export const budgets = sqliteTable("budgets", {
  id: text("id").primaryKey().$defaultFn(newUuid),
  name: text("name").notNull(),
  categoryId: text("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  amount: text("amount").notNull(),
  period: text("period").notNull(), // weekly | monthly | quarterly | yearly
  rollover: integer("rollover", { mode: "boolean" }).notNull().default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── App Settings (singleton row id=1) ───────────────────────────────────────

/** Tax-deductions report config: WFH hours per FY plus per-category claim
 * rules. Stored as a single JSON blob on the singleton app_settings row;
 * keeps the categories table free of tax-specific columns and lets the user
 * edit/reset rules without schema churn. */
export type TaxConfig = {
  wfhHoursByFy: Record<number, number>;
  categoryRules: Record<
    string,
    { workUsePct: number; bundledInWfh: boolean; note?: string }
  >;
};

/** Scheduled-backup config — drives the singleton scheduler in
 * `src/lib/backup/scheduler.ts`. `intervalDays` may be fractional for
 * test/operator convenience (e.g. 0.04 ≈ 1 hour). `retain` is the
 * number of `scheduled` backups to keep; manual + pre-restore backups
 * are sticky. `lastRunAt` is updated each tick so the scheduler can
 * resume cadence across restarts. */
export type BackupSchedule = {
  enabled: boolean;
  intervalDays: number;
  retain: number;
  lastRunAt: string | null;
};

/** Ordered list of "people" tracked on the super page. Each entry's
 *  `key` matches `superannuation_snapshots.person`; `label` is the
 *  display name shown in the UI. The legacy `super_self_label` /
 *  `super_partner_label` columns are still read as a backfill source
 *  for keys "self" and "partner" when this column is null, but new
 *  writes go through this list. */
export type SuperPerson = { key: string; label: string };

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  // Legacy: only read as a fallback when `super_people` is null and
  // a snapshot uses key "self" / "partner". New label updates land
  // in the `superPeople` JSON column instead.
  superSelfLabel: text("super_self_label"),
  superPartnerLabel: text("super_partner_label"),
  superPeople: text("super_people", { mode: "json" }).$type<SuperPerson[]>(),
  taxConfig: text("tax_config", { mode: "json" }).$type<TaxConfig>(),
  backupSchedule: text("backup_schedule", { mode: "json" }).$type<BackupSchedule>(),
  /** DB-backed equivalent of the per-browser localStorage blob —
   * unified place for every client toggle / view preference. Shape
   * is owned by `src/lib/display-prefs.ts` (DisplayPrefs interface).
   * Parsed defensively at every read so a malformed or partial blob
   * still surfaces sensible defaults. */
  displayPrefs: text("display_prefs", { mode: "json" }).$type<
    Partial<Record<string, unknown>>
  >(),
  /** Idempotency flag for the unlock-time sample-data seeder.
   * Set to 1 the first time the seeder runs (or when the seeder
   * detects an existing populated DB and skips). Once 1, never seed
   * again — even after the user has wiped sample data. */
  sampleDataSeeded: integer("sample_data_seeded", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Idempotency flag for the orphan-transfer → synthetic backfill
   * (see src/lib/backfill-orphan-transfers.ts). Set to 1 the first
   * time the backfill runs on this DB. Once 1, the unlock-time
   * runner skips — so restoring an older DB doesn't repeatedly
   * mint synthetics for the same orphan rows on every unlock.
   * Surface a Settings → Maintenance button to reset + re-run if
   * the operator wants the backfill to evaluate fresh. */
  transferBackfillDone: integer("transfer_backfill_done", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Optional Brave Search subscription token for the supplemental
   * web-source announcements on the investment-detail panel.
   * Settable from Settings → General; the `BRAVE_SEARCH_API_KEY`
   * env var takes precedence when both are set (containers can
   * inject the key without touching the DB). Stored in the
   * encrypted DB — same protection envelope as the rest of the
   * household ledger. */
  braveSearchApiKey: text("brave_search_api_key"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Transfer Suggestions ─────────────────────────────────────────────────────

export const transferSuggestions = sqliteTable(
  "transfer_suggestions",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("transfer_suggestions_pair_idx").on(
      t.transactionId,
      t.candidateId,
    ),
    index("transfer_suggestions_txn_idx").on(t.transactionId),
    index("transfer_suggestions_cand_idx").on(t.candidateId),
  ],
);

/** Pairs the user has explicitly rejected as transfer matches. The
 *  pair is stored in canonical (transactionId < candidateId) order
 *  to match how `pairTransfersInWindow` orders its candidates, so
 *  the lookup is a single primary-key probe. Without this table,
 *  the matcher kept re-discovering and re-inserting the same pair
 *  every run — the unique-index guard on `transfer_suggestions`
 *  only fires when a row already exists, which it doesn't after a
 *  dismiss DELETE. */
export const dismissedTransferPairs = sqliteTable(
  "dismissed_transfer_pairs",
  {
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.transactionId, t.candidateId] }),
    index("dismissed_transfer_pairs_candidate_idx").on(t.candidateId),
  ],
);

// ─── Payee Rules ──────────────────────────────────────────────────────────────

export const payeeRules = sqliteTable(
  "payee_rules",
  {
  id: text("id").primaryKey().$defaultFn(newUuid),
  normalizedPayee: text("normalized_payee").notNull(),
  // Inclusive bounds. NULL = unbounded on that side. The matcher prefers
  // narrower (more-specific) rules when multiple match a given (payee, amount).
  minAmount: text("min_amount"),
  maxAmount: text("max_amount"),
  categoryId: text("category_id").references(() => categories.id, {
    onDelete: "set null",
  }),
  source: text("source").notNull().default("user"), // 'user' | 'ai'
  confidence: integer("confidence").notNull().default(100),
  /** See accounts.isSample. The current sample-data set ships zero
   * rules, but the column is here so the bulk-removal query has a
   * consistent shape across the four tables it sweeps. */
  isSample: integer("is_sample", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  },
  (t) => [
    // Every CSV import runs batchLookupPayeeRules() with
    // `WHERE normalized_payee IN (?, …)` across the import's distinct
    // payees. Without this index that's a full scan per payee.
    index("payee_rules_normalized_payee_idx").on(t.normalizedPayee),
  ],
);

// ─── Schedule Suggestion Dismissals ───────────────────────────────────────────

export const scheduleSuggestionDismissals = sqliteTable(
  "schedule_suggestion_dismissals",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    normalizedPayee: text("normalized_payee").notNull(),
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("schedule_suggestion_dismissals_unique_idx").on(
      t.accountId,
      t.normalizedPayee,
    ),
    index("schedule_suggestion_dismissals_account_idx").on(t.accountId),
  ],
);

// ─── Scheduled Forecasts ──────────────────────────────────────────────────────
// Per-occurrence expected-amount overrides for variable schedules (utilities,
// energy, etc.). The schedule's own amount remains the headline / matching
// fallback; a forecast row tightens the expected for one specific occurrence.

export const scheduledForecasts = sqliteTable(
  "scheduled_forecasts",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    scheduledId: text("scheduled_id")
      .notNull()
      .references(() => scheduledTransactions.id, { onDelete: "cascade" }),
    occurrenceDate: text("occurrence_date").notNull(),
    amount: text("amount").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("scheduled_forecasts_unique_idx").on(
      t.scheduledId,
      t.occurrenceDate,
    ),
    index("scheduled_forecasts_scheduled_idx").on(t.scheduledId),
  ],
);

// ─── Missed Scheduled Dismissals ──────────────────────────────────────────────

export const missedScheduledDismissals = sqliteTable(
  "missed_scheduled_dismissals",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    scheduledId: text("scheduled_id")
      .notNull()
      .references(() => scheduledTransactions.id, { onDelete: "cascade" }),
    occurrenceDate: text("occurrence_date").notNull(),
    note: text("note").notNull().default(""),
    dismissedAt: integer("dismissed_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("missed_scheduled_dismissals_unique_idx").on(
      t.scheduledId,
      t.occurrenceDate,
    ),
    index("missed_scheduled_dismissals_scheduled_idx").on(t.scheduledId),
  ],
);

// ─── Investments ──────────────────────────────────────────────────────────────

export const investments = sqliteTable(
  "investments",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    // 'stock' = outright share purchase; 'rsu' = restricted stock unit grant
    // (cost basis 0); 'option' = stock option (uses strike_price + expiry).
    kind: text("kind").notNull(),
    symbol: text("symbol").notNull(), // e.g. 'AAPL', 'BHP.AX'
    exchange: text("exchange").notNull(), // 'ASX' | 'US'
    name: text("name"),
    currency: text("currency").notNull(), // 'AUD' | 'USD'
    accountId: text("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    quantity: text("quantity").notNull(),
    // For stock: trade date. For rsu/option: grant date.
    purchaseDate: text("purchase_date").notNull(),
    // Cost basis per share. Stocks: trade price. RSU: typically null (=0).
    // Option: typically the strike (kept here for symmetry; strike_price is
    // the authoritative copy used in intrinsic-value calc).
    purchasePrice: text("purchase_price"),
    strikePrice: text("strike_price"),
    expiryDate: text("expiry_date"),
    // For AU-style LTI / performance rights: the service-period anchor (e.g.
    // 1 year after grant). Independent from the vest schedule — a grant with
    // a 1-year service requirement and 3-year maturation has service_date
    // 1y after grant, and a vest entry on the 3y maturation date.
    serviceDate: text("service_date"),
    notes: text("notes"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("investments_symbol_idx").on(t.symbol)],
);

export const investmentVests = sqliteTable(
  "investment_vests",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    investmentId: text("investment_id")
      .notNull()
      .references(() => investments.id, { onDelete: "cascade" }),
    vestDate: text("vest_date").notNull(),
    quantity: text("quantity").notNull(),
    // Free-text performance condition; e.g. 'TSR > peer median over 3y'.
    performanceNote: text("performance_note"),
    // Toggle for performance-conditional vests that haven't met their bar:
    // false → exclude from vested-quantity calc.
    isSatisfied: integer("is_satisfied", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("investment_vests_investment_idx").on(t.investmentId)],
);

// Cache of close prices fetched from Yahoo so repeat history requests for the
// same symbol+date don't hit the upstream every time. Symbol is the Yahoo
// ticker as stored on `investments.symbol` (with .AX suffix for ASX).
export const investmentPrices = sqliteTable(
  "investment_prices",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(),
    close: text("close").notNull(),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    uniqueIndex("investment_prices_unique_idx").on(t.symbol, t.date),
    index("investment_prices_symbol_idx").on(t.symbol),
  ],
);

// Per-ticker news cache for the investments "Recent announcements"
// panel. Yahoo returns ~10 items per query; we dedup on (symbol,
// uuid) and only refetch when fetched_at is older than the TTL set
// in the /api/investments/[id]/news handler.
export const investmentNews = sqliteTable(
  "investment_news",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    symbol: text("symbol").notNull(),
    uuid: text("uuid").notNull(),
    title: text("title").notNull(),
    publisher: text("publisher"),
    link: text("link").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    thumbnail: text("thumbnail"),
    fetchedAt: integer("fetched_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    /** Origin of the row — Yahoo Finance news API ("yahoo") or
     * Brave Search Web API ("web"). Defaults to yahoo for legacy
     * rows that pre-date the dual-source split. */
    source: text("source").notNull().default("yahoo"),
    /** Short snippet/description text. Populated by Brave's
     * `description` field; Yahoo never sets this. */
    description: text("description"),
  },
  (t) => [
    uniqueIndex("investment_news_symbol_uuid_idx").on(t.symbol, t.uuid),
    index("investment_news_symbol_fetched_at_idx").on(t.symbol, t.fetchedAt),
  ],
);

// Tickers the user wants to watch but hasn't bought. Distinct from
// `investments` so cost-basis / quantity / vest schedule logic doesn't
// have to special-case zero-quantity rows. Symbol is unique because
// watching the same ticker twice is just noise.
export const watchlist = sqliteTable(
  "watchlist",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    symbol: text("symbol").notNull(),
    exchange: text("exchange").notNull(),
    name: text("name"),
    currency: text("currency").notNull(),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("watchlist_symbol_unique").on(t.symbol)],
);

// Yearly superannuation snapshot — one row per fund per FY-end year. Stores
// the end-of-FY balance and total contributions made during that FY; the UI
// derives YoY gain, fund return %, etc. on the client.
export const superannuationSnapshots = sqliteTable(
  "superannuation_snapshots",
  {
    id: text("id").primaryKey().$defaultFn(newUuid),
    fyEndYear: integer("fy_end_year").notNull(),
    balance: text("balance").notNull(),
    contributions: text("contributions").notNull().default("0"),
    // 'self' or 'partner' — splits the page so a couple can track both
    // accounts side-by-side without mixing snapshots.
    person: text("person").notNull().default("self"),
    fundName: text("fund_name"),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    index("super_year_idx").on(t.fyEndYear),
    index("super_person_idx").on(t.person),
  ],
);

// ─── Relations ────────────────────────────────────────────────────────────────

export const accountsRelations = relations(accounts, ({ many }) => ({
  transactions: many(transactions),
  scheduledTransactions: many(scheduledTransactions),
  importLogs: many(importLogs),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "subcategories",
  }),
  children: many(categories, { relationName: "subcategories" }),
  transactions: many(transactions),
  budgets: many(budgets),
  scheduledTransactions: many(scheduledTransactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
  }),
  category: one(categories, {
    fields: [transactions.categoryId],
    references: [categories.id],
  }),
  importLog: one(importLogs, {
    fields: [transactions.importLogId],
    references: [importLogs.id],
  }),
  transferPair: one(transactions, {
    fields: [transactions.transferPairId],
    references: [transactions.id],
    relationName: "transferPair",
  }),
}));

export const scheduledTransactionsRelations = relations(
  scheduledTransactions,
  ({ one }) => ({
    account: one(accounts, {
      fields: [scheduledTransactions.accountId],
      references: [accounts.id],
    }),
    category: one(categories, {
      fields: [scheduledTransactions.categoryId],
      references: [categories.id],
    }),
    transferToAccount: one(accounts, {
      fields: [scheduledTransactions.transferToAccountId],
      references: [accounts.id],
    }),
  }),
);

export const budgetsRelations = relations(budgets, ({ one }) => ({
  category: one(categories, {
    fields: [budgets.categoryId],
    references: [categories.id],
  }),
}));

export const importLogsRelations = relations(importLogs, ({ one, many }) => ({
  account: one(accounts, {
    fields: [importLogs.accountId],
    references: [accounts.id],
  }),
  transactions: many(transactions),
}));

export const investmentsRelations = relations(investments, ({ one, many }) => ({
  account: one(accounts, {
    fields: [investments.accountId],
    references: [accounts.id],
  }),
  vests: many(investmentVests),
}));

export const investmentVestsRelations = relations(
  investmentVests,
  ({ one }) => ({
    investment: one(investments, {
      fields: [investmentVests.investmentId],
      references: [investments.id],
    }),
  }),
);

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type ScheduledTransaction = typeof scheduledTransactions.$inferSelect;
export type Budget = typeof budgets.$inferSelect;
export type ImportLog = typeof importLogs.$inferSelect;
export type ScheduledForecast = typeof scheduledForecasts.$inferSelect;
export type NewScheduledForecast = typeof scheduledForecasts.$inferInsert;

export type NewAccount = typeof accounts.$inferInsert;
export type NewCategory = typeof categories.$inferInsert;
export type NewTransaction = typeof transactions.$inferInsert;
export type NewScheduledTransaction = typeof scheduledTransactions.$inferInsert;
export type NewBudget = typeof budgets.$inferInsert;
export type AppSettings = typeof appSettings.$inferSelect;
export type PayeeRule = typeof payeeRules.$inferSelect;
export type TransferSuggestion = typeof transferSuggestions.$inferSelect;
export type Investment = typeof investments.$inferSelect;
export type NewInvestment = typeof investments.$inferInsert;
export type InvestmentVest = typeof investmentVests.$inferSelect;
export type NewInvestmentVest = typeof investmentVests.$inferInsert;
export type InvestmentPrice = typeof investmentPrices.$inferSelect;
export type InvestmentNews = typeof investmentNews.$inferSelect;
export type NewInvestmentNews = typeof investmentNews.$inferInsert;
export type WatchlistEntry = typeof watchlist.$inferSelect;
export type NewWatchlistEntry = typeof watchlist.$inferInsert;
export type SuperSnapshot = typeof superannuationSnapshots.$inferSelect;
export type NewSuperSnapshot = typeof superannuationSnapshots.$inferInsert;
