import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { transactions, accounts, categories, importLogs } from "@/db/schema";
import { alias } from "drizzle-orm/sqlite-core";
import { eq, and, gte, lte, desc, asc, like, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePayee, deriveMatchPayee, loadTokenFreq } from "@/lib/categorize";
import { isoDateString, numericString } from "@/lib/zod-helpers";
import { categoryDescendantIds } from "@/lib/category-descendants";

const createSchema = z.object({
  accountId: z.string().uuid(),
  date: isoDateString,
  amount: numericString,
  payee: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
  /** When set, the row is treated as the SOURCE leg of a transfer
   *  and a paired destination leg is auto-created in the named
   *  account. The dest leg gets the inverted sign (so a -100 source
   *  spawns a +100 dest), and both rows are cross-linked via
   *  `transferPairId`. Sharing date / payee / category / notes
   *  keeps the pair self-consistent in reports. */
  transferToAccountId: z.string().uuid().optional().nullable(),
  /** Synthetic-leg transfer: when true and no
   *  `transferToAccountId` is supplied, the server finds-or-creates
   *  the default "External" account and uses it as the destination,
   *  marking the dest leg `isSynthetic = true`. Mirrors the
   *  backfill behaviour for orphan transfers — the operator records
   *  a transfer whose counterparty isn't a tracked account. */
  syntheticTransfer: z.boolean().optional(),
});

const DEFAULT_EXTERNAL_NAME = "External";

/** Find-or-create the synthetic-counterparty account. Mirrors the
 *  helper at the top of `src/lib/backfill-orphan-transfers.ts`,
 *  duplicated here so the manual-add path can mint synthetic legs
 *  without pulling that whole module's TDZ-prone export surface in. */
async function findOrCreateExternalAccount(): Promise<string> {
  const existing = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.isExternal, true),
        sql`lower(${accounts.name}) = ${DEFAULT_EXTERNAL_NAME.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return existing[0].id;
  const [created] = await db
    .insert(accounts)
    .values({
      name: DEFAULT_EXTERNAL_NAME,
      type: "cash",
      currency: "AUD",
      isExternal: true,
      isArchived: false,
      startingBalance: "0",
      currentBalance: "0",
    })
    .returning({ id: accounts.id });
  return created.id;
}

const pairTxn = alias(transactions, "pair_txn");
const pairAcct = alias(accounts, "pair_acct");

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const categoryId = searchParams.get("categoryId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const search = searchParams.get("search");
  // Three-state filter:
  //   transfersFilter=only  → only paired (transfer/payment) rows
  //   transfersFilter=none  → only non-paired rows
  //   anything else / absent → no filter
  // For backward-compat with old bookmarks, transfersOnly=true still maps to "only".
  const transfersFilterRaw = searchParams.get("transfersFilter");
  const transfersFilter: "only" | "none" | null =
    transfersFilterRaw === "only" || transfersFilterRaw === "none"
      ? transfersFilterRaw
      : searchParams.get("transfersOnly") === "true"
        ? "only"
        : null;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1") || 1);
  // limit is bounded so a malformed or hostile client can't ask for the
  // entire transactions table in one go. The scheduled view legitimately
  // requests up to 10k for budget rollups across heavy categories — keep
  // the cap above that with headroom.
  const LIMIT_MAX = 50000;
  const requestedLimit = parseInt(searchParams.get("limit") ?? "50") || 50;
  const limit = Math.min(LIMIT_MAX, Math.max(1, requestedLimit));
  const offset = (page - 1) * limit;

  const includeChildren = searchParams.get("includeChildren") === "true";

  // Accept either a single `accountId` (legacy filter bar) or a comma-
  // separated `accountIds` list (global sidebar filter). When both are
  // provided, we intersect — the single filter narrows further.
  const accountIdsRaw = searchParams.get("accountIds");
  const accountIdsList = accountIdsRaw
    ? accountIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const conditions = [];
  // Explicit id filter — comma-separated UUIDs. Short-circuits the
  // default account/date scope so a short-list popup (e.g. the
  // unlink-confirmation dialog) gets exactly the rows it asked for
  // even when one leg lives in an archived account or sits outside
  // the visible date window.
  const idsRaw = searchParams.get("ids");
  const idList = idsRaw
    ? idsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (idList.length > 0) {
    conditions.push(
      idList.length === 1
        ? eq(transactions.id, idList[0])
        : inArray(transactions.id, idList),
    );
  } else {
    // The page-level `accountId` (the visible dropdown) takes precedence —
    // when it's set, ignore the global sidebar's `accountIds` filter so the
    // user can drill into a specific account without it being intersected
    // with the sidebar's multi-select. The dropdown is the more specific
    // intent.
    if (accountId) {
      conditions.push(eq(transactions.accountId, accountId));
    } else if (accountIdsList.length > 0) {
      conditions.push(inArray(transactions.accountId, accountIdsList));
    } else {
      // No explicit account filter → default to non-archived accounts only.
      // Archived accounts are hidden in the UI; "All accounts" should mean
      // "all visible accounts", not "actually all".
      conditions.push(
        sql`${transactions.accountId} IN (SELECT id FROM accounts WHERE is_archived = false)`,
      );
    }
  }
  if (categoryId === "__uncat__") {
    // Sentinel value from the cashflow report's "Uncategorised" rows and the
    // filter dropdown — match transactions with no category set.
    conditions.push(isNull(transactions.categoryId));
  } else if (categoryId) {
    if (includeChildren) {
      const ids = await categoryDescendantIds(categoryId);
      conditions.push(
        ids.length > 1
          ? inArray(transactions.categoryId, ids)
          : eq(transactions.categoryId, ids[0] ?? categoryId),
      );
    } else {
      conditions.push(eq(transactions.categoryId, categoryId));
    }
  }
  if (from) conditions.push(gte(transactions.date, from));
  if (to) conditions.push(lte(transactions.date, to));
  if (search) {
    // SQLite's LIKE is case-insensitive for ASCII by default. ilike is
    // Postgres-only — using it here was a leftover from the PG → SQLite
    // migration that surfaced as a 500 ("near 'ilike': syntax error").
    conditions.push(like(transactions.payee, `%${search}%`));
  }
  if (transfersFilter === "only") {
    conditions.push(isNotNull(transactions.transferPairId));
  } else if (transfersFilter === "none") {
    conditions.push(isNull(transactions.transferPairId));
  }

  // Drill-through filter from the accounts report's per-counterparty
  // rows: "transactions whose paired leg lives in account X". Two
  // accepted shapes:
  //   <uuid>     → restrict to rows whose transfer_pair_id points to
  //                a transaction in that account.
  //   "external" → restrict to transfers that have no paired leg
  //                recorded (the "External" counterparty bucket in
  //                the accounts report). Mirrors the cashflow API's
  //                dual condition so the resulting list matches the
  //                cell's source-of-truth.
  // Anything else is silently ignored — same pattern as the other
  // validated params.
  // Synthetic-leg model (migration 0009): every transfer has a real
  // `transfer_pair_id`, including transfers whose other leg lives in
  // an isExternal=true placeholder account. The drill-through from
  // the Accounts report's per-counterparty rows just passes the
  // counterparty's account UUID — the legacy `external` sentinel
  // (used pre-backfill to find orphan `is_transfer=1` rows with no
  // pair_id) is no longer needed and is silently ignored.
  const transferPairAccountIdRaw = searchParams.get("transferPairAccountId");
  if (transferPairAccountIdRaw && transferPairAccountIdRaw !== "external") {
    const uuidParse = z
      .string()
      .uuid()
      .safeParse(transferPairAccountIdRaw);
    if (uuidParse.success) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM transactions p
          WHERE p.id = ${transactions.transferPairId}
            AND p.account_id = ${uuidParse.data}
        )`,
      );
    }
  }

  // direction=out  → only outflows (amount < 0)
  // direction=in   → only inflows  (amount > 0)
  // anything else  → no filter
  const direction = searchParams.get("direction");
  if (direction === "out") conditions.push(sql`CAST(${transactions.amount} AS REAL) < 0`);
  else if (direction === "in") conditions.push(sql`CAST(${transactions.amount} AS REAL) > 0`);

  // hideTransfers=true excludes rows whose category is flagged as an inner
  // transfer (asset-to-asset moves). External payments are kept — they're
  // real expenses. Mirrors the same toggle in /api/reports so the drilldown's
  // transactions panel agrees with the breakdown above it.
  if (searchParams.get("hideTransfers") === "true") {
    conditions.push(
      sql`(${transactions.categoryId} IS NULL OR EXISTS (
        SELECT 1 FROM categories c WHERE c.id = ${transactions.categoryId} AND c.transfer_kind != 'internal'
      ))`,
    );
  }

  // When the result is scoped to one account we can attach a running balance
  // to each row — useful for the txns list. Multi-account / unfiltered views
  // get NULL since one running balance can't represent multiple accounts.
  const singleAccountId =
    accountId ?? (accountIdsList.length === 1 ? accountIdsList[0] : null);

  const sort = searchParams.get("sort") ?? "date";
  const order = searchParams.get("order") ?? "desc";
  const dir = order === "asc" ? asc : desc;
  let primarySort;
  switch (sort) {
    case "account": primarySort = dir(accounts.name); break;
    case "category": primarySort = dir(categories.name); break;
    case "payee": primarySort = dir(transactions.payee); break;
    case "value": primarySort = dir(transactions.amount); break;
    default: primarySort = dir(transactions.date);
  }
  // For date-sorted views, posted_seq comes first — both parsers (OFX and
  // CSV/QIF after the file-index assignment) write it in bank-chronological
  // order, including the direction-flip for newest-first files where
  // created_at would point the OPPOSITE way. The COALESCE timestamp is the
  // fallback for legacy rows that pre-date posted_seq (NULL → 0 ties them
  // all and lets created_at break the tie the way it always did).
  const dateExtraSorts =
    sort === "date"
      ? [
          dir(sql`COALESCE(${transactions.postedSeq}, 0)`),
          dir(sql`COALESCE(${transactions.postedAt}, ${transactions.createdAt})`),
        ]
      : [desc(transactions.date)];
  // Final tiebreaker on id so LIMIT/OFFSET pagination is deterministic when
  // multiple rows tie on every other key — otherwise the same row can appear
  // on two consecutive infinite-scroll pages and React errors.
  const tieSort = desc(transactions.id);

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      payee: transactions.payee,
      description: transactions.description,
      notes: transactions.notes,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountColor: accounts.color,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      isReconciled: transactions.isReconciled,
      type: transactions.type,
      // Bank-supplied post-transaction balance (CSV "Balance" column).
      // Surface alongside the computed running balance so the view can
      // flag any mismatch between what we calculate and what the bank
      // actually had on the statement.
      bankBalance: transactions.balance,
      transferPairId: transactions.transferPairId,
      pairAccountId: pairTxn.accountId,
      pairAccountName: pairAcct.name,
      pairAccountColor: pairAcct.color,
      pairAmount: pairTxn.amount,
      pairDate: pairTxn.date,
      pairPayee: pairTxn.payee,
      // Running balance after this transaction posts. Sums every txn that
      // sorts at-or-before this one in the lineage (date, posted_seq,
      // posted_at|created_at, id) and adds the account's starting balance.
      // Tuple comparison matches the ORDER BY above key-for-key so the
      // visible list and the balance column always agree. Only set on
      // single-account queries; null otherwise.
      balance: singleAccountId
        ? sql<
            string | null
          >`CAST((CAST(${accounts.startingBalance} AS REAL) + COALESCE((SELECT SUM(CAST(t2.amount AS REAL)) FROM ${transactions} t2 WHERE t2.account_id = ${transactions.accountId} AND (t2.date, COALESCE(t2.posted_seq, 0), COALESCE(t2.posted_at, t2.created_at), t2.id) <= (${transactions.date}, COALESCE(${transactions.postedSeq}, 0), COALESCE(${transactions.postedAt}, ${transactions.createdAt}), ${transactions.id})), 0)) AS TEXT)`
        : sql<string | null>`NULL`,
      // Extra metadata surfaced in the row-expansion panel — everything
      // the user might want to see when troubleshooting an import or
      // checking provenance, without bloating the visible row.
      isTransfer: transactions.isTransfer,
      normalizedPayee: transactions.normalizedPayee,
      postedAt: transactions.postedAt,
      postedSeq: transactions.postedSeq,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
      importLogId: transactions.importLogId,
      importHash: transactions.importHash,
      rawFitid: transactions.rawFitid,
      // Format of the import that brought this row in: csv | ofx | qfx | qif.
      // Surfaced in the row-expansion panel so the user can see the
      // provenance when troubleshooting an import.
      importFormat: importLogs.format,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(pairTxn, eq(transactions.transferPairId, pairTxn.id))
    .leftJoin(pairAcct, eq(pairTxn.accountId, pairAcct.id))
    .leftJoin(importLogs, eq(transactions.importLogId, importLogs.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(primarySort, ...dateExtraSorts, tieSort)
    .limit(limit)
    .offset(offset);

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data = createSchema.parse(body);

  const normalized = data.payee ? normalizePayee(data.payee) : null;
  const tokenFreq = await loadTokenFreq();
  const matchPayee = deriveMatchPayee(normalized, tokenFreq);

  // Resolve the transfer destination. Three shapes are valid:
  //   - real account id passed in transferToAccountId  → ordinary
  //     two-leg transfer between tracked accounts.
  //   - syntheticTransfer flag + no destination        → find-or-create
  //     the "External" account and mark the dest leg `isSynthetic`,
  //     matching the orphan-transfer backfill behaviour.
  //   - neither                                         → not a transfer.
  let resolvedTransferTo: string | null = data.transferToAccountId ?? null;
  let destIsSynthetic = false;
  if (!resolvedTransferTo && data.syntheticTransfer) {
    resolvedTransferTo = await findOrCreateExternalAccount();
    destIsSynthetic = true;
  }

  // Transfer path: insert both legs in one transaction and cross-link
  // them via `transferPairId`. The dest leg gets the opposite sign so
  // the pair nets to zero in cashflow rollups; the rest of the
  // payload (date, payee, category, notes, description) is mirrored.
  if (resolvedTransferTo) {
    if (resolvedTransferTo === data.accountId) {
      return NextResponse.json(
        { error: "Transfer source and destination must differ" },
        { status: 400 },
      );
    }
    const destAmount = (-Number.parseFloat(data.amount)).toFixed(2);
    const {
      transferToAccountId: _ignore1,
      syntheticTransfer: _ignore2,
      ...shared
    } = data;
    void _ignore1;
    void _ignore2;
    const result = await db.transaction(async (tx) => {
      const [source] = await tx
        .insert(transactions)
        .values({
          ...shared,
          normalizedPayee: normalized,
          matchPayee,
        })
        .returning();
      const [dest] = await tx
        .insert(transactions)
        .values({
          ...shared,
          accountId: resolvedTransferTo!,
          amount: destAmount,
          isSynthetic: destIsSynthetic,
          normalizedPayee: normalized,
          matchPayee,
        })
        .returning();
      await tx
        .update(transactions)
        .set({ transferPairId: dest.id, updatedAt: new Date() })
        .where(eq(transactions.id, source.id));
      await tx
        .update(transactions)
        .set({ transferPairId: source.id, updatedAt: new Date() })
        .where(eq(transactions.id, dest.id));
      // Recompute both account balances.
      for (const acctId of [data.accountId, resolvedTransferTo!]) {
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`(SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${acctId}) + ${accounts.startingBalance}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, acctId));
      }
      return { source, dest };
    });
    return NextResponse.json(result, { status: 201 });
  }

  const {
    transferToAccountId: _ignored1,
    syntheticTransfer: _ignored2,
    ...singleData
  } = data;
  void _ignored1;
  void _ignored2;
  const [row] = await db
    .insert(transactions)
    .values({
      ...singleData,
      normalizedPayee: normalized,
      matchPayee,
    })
    .returning();

  // Update account balance
  await db
    .update(accounts)
    .set({
      currentBalance: sql`(SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${data.accountId}) + ${accounts.startingBalance}`,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, data.accountId));

  return NextResponse.json(row, { status: 201 });
}
