import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, categories, transactions } from "@/db/schema";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { detectFormat } from "@/lib/import/detect-format";
import { parseCSV } from "@/lib/import/parse-csv";
import { parseOFX, type OFXMeta } from "@/lib/import/parse-ofx";
import { parseQIF, type QIFAccountInfo, type QIFSplit } from "@/lib/import/parse-qif";
import { oldImportHash } from "@/lib/import/hash";
import {
  resolveAccountByAlias,
  resolveAccountByLast4,
} from "@/lib/import/resolve-account";
import {
  normalizePayee,
  batchLookupPayeeRules,
  suggestCategoryByHistory,
  deriveMatchPayee,
  loadTokenFreq,
} from "@/lib/categorize";
import { trigramSimilarity } from "@/lib/trigram";
import { withAuth } from "@/lib/api/route-guards";

interface Neighbour {
  normalizedPayee: string;
  similarity: number;
  amount: number;
  categoryName: string | null;
}

interface CategoryRange {
  categoryName: string | null;
  support: number;
  minAmount: number;
  maxAmount: number;
  isPicked: boolean;
}

interface TestResultRow {
  date: string;
  amount: string;
  payee: string;
  normalizedPayee: string;
  importHash: string;
  rawId: string;
  /** Where this row was found in the existing DB — three levels of
   * confidence:
   *   "exact"    — importHash already in DB (production dedupe would skip)
   *   "legacy"   — old hash form matches (pre-rawId-fix import)
   *   "possible" — date + amount matches an existing row, but hashes
   *                differ. Most useful when the original import was via a
   *                different format (e.g. existing OFX, new QIF) so hash
   *                machinery can't bridge them. NOT skipped by the
   *                production importer.
   *   undefined  — no match. */
  matchType?: "exact" | "legacy" | "possible";
  /** Snapshot of the matched DB row so the UI can render a diff alongside
   * the new import. */
  existingDate?: string | null;
  existingAmount?: string | null;
  existingPayee?: string | null;
  existingCategoryName?: string | null;
  existingAccountName?: string | null;
  existingType?: string | null;
  existingBalance?: string | null;
  existingPostedSeq?: number | null;
  /** Result of cross-checking the imported running balance against the
   * resolved account's history in the DB:
   *   match=true     — predicted balance (account.starting + DB sum
   *                    through this date + earlier new-row amounts in
   *                    file order) equals row.runningBalance.
   *   match=false    — file's balance disagrees with what the DB says
   *                    should be there (within $0.01 tolerance).
   *   undefined      — couldn't compute (no balance, no resolved account,
   *                    etc.). */
  balanceCheck?: {
    match: boolean;
    predicted: number;
    claimed: number;
    delta: number;
    /** "chain" — predicted from the previous row's balance + this amount.
     *  "anchor" — predicted from DB starting balance + sum strictly before
     *             this date (only used for the first chronological row in
     *             an account, when its date has no DB rows on it). */
    mode: "chain" | "anchor";
  };
  /** DB-side chain check for duplicate-matched rows. Walks the
   * existing DB rows in `(date, posted_seq, posted_at|created_at,
   * id)` order — same tuple the running-balance view uses — and
   * compares each row's stored bank balance to the chain-predicted
   * value. `match=false` here means the existing `posted_seq` order
   * doesn't reproduce the bank's claimed balance, i.e. intra-day
   * sequencing in the DB is wrong. Only computed for matched rows
   * whose file row carries a `runningBalance`. */
  balanceCheckVsDB?: {
    match: boolean;
    expected: number;
    claimed: number;
    delta: number;
  };
  /** Bank-supplied transaction type the importer would write to
   * `transactions.type` — derived from QIF L / OFX TRNTYPE / CSV
   * Categories. */
  resolvedType?: string | null;
  /** Account the importer would route this row to. Tries the
   * `account_aliases` table first, then `accounts.account_number_last4`,
   * then the existing-match's accountId (if any). null when no layer
   * matched — production import would fall back to the user's chosen
   * target account. */
  resolvedAccountId?: string | null;
  resolvedAccountName?: string | null;
  resolvedAccountVia?: "alias" | "last4" | "heuristic-match" | null;
  /** rule | trigram | none */
  method: "rule" | "trigram" | "none";
  categoryId: string | null;
  categoryName: string | null;
  /** Trigram only: 0..1, the suggester's confidence-ish score. */
  score?: number;
  /** Trigram only: how many historical txns backed the chosen category. */
  support?: number;
  /** Trigram only: the top 5 nearest neighbours so the user can see why
   * the category was picked. */
  neighbours?: Neighbour[];
  /** Trigram only: per-category amount ranges drawn from the matched
   * neighbourhood — useful to spot a misclassification when the incoming
   * amount falls outside the dominant category's typical range. */
  categoryRanges?: CategoryRange[];
  /** Format-specific extras — surfaced so the user can compare what each
   * format actually carries beyond the date/amount/payee minimum. */
  qifAccount?: QIFAccountInfo;
  qifSectionType?: string;
  checkNum?: string;
  cleared?: string;
  bankCategory?: string;
  address?: string[];
  splits?: QIFSplit[];
  trnType?: string;
  refNum?: string;
  runningBalance?: string;
  postedSeq?: number | null;
}

/**
 * Dry-run categorisation: parse the uploaded file, score each row
 * (explicit rule → trigram suggester), check it against the DB for
 * exact / legacy-hash / heuristic duplicates, and surface per-row
 * detail (resolved account, balance-chain check, posted_seq, …) so
 * the import-view's review panel can let the operator audit before
 * committing. Writes NOTHING to the DB.
 */
export const POST = withAuth(async (request) => {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // Stage toggles let the user A/B different parts of the pipeline.
  // Categorisation is entirely local — no AI step.
  const useRules = formData.get("useRules") !== "false";
  const useTrigram = formData.get("useTrigram") !== "false";

  const content = await file.text();
  const format = detectFormat(file.name, content);

  let rows: ReturnType<typeof parseQIF> = [];
  let ofxMeta: OFXMeta | undefined;
  try {
    if (format === "csv") rows = parseCSV(content);
    else if (format === "ofx" || format === "qfx") {
      const r = parseOFX(content);
      rows = r.rows;
      ofxMeta = r.meta;
    } else if (format === "qif") rows = parseQIF(content);
  } catch (e) {
    return NextResponse.json(
      { error: `Parse error: ${(e as Error).message}` },
      // Issue #98: was 422; every other validation failure in the
      // codebase is 400. Standardising.
      { status: 400 },
    );
  }

  // Existing-record check, three layers:
  //   1) importHash (strict — what production dedupe uses)
  //   2) oldImportHash (legacy form, pre-rawId fix)
  //   3) (date + amount) heuristic — bridges format changes (e.g. existing
  //      OFX import vs. fresh QIF re-export of the same statement) where
  //      payee strings differ enough that even oldImportHash misses.
  //      Surfaced as "possible" so the user knows production dedupe will
  //      NOT skip these.
  const newHashes = rows.map((r) => r.importHash).filter(Boolean);
  const oldHashes = rows.map((r) => oldImportHash(r));
  const lookupHashes = [...new Set([...newHashes, ...oldHashes])];
  const existing = lookupHashes.length
    ? await db
        .select({
          id: transactions.id,
          importHash: transactions.importHash,
          date: transactions.date,
          amount: transactions.amount,
          payee: transactions.payee,
          categoryId: transactions.categoryId,
          accountId: transactions.accountId,
          accountName: accounts.name,
          type: transactions.type,
          balance: transactions.balance,
          postedSeq: transactions.postedSeq,
        })
        .from(transactions)
        .leftJoin(accounts, eq(accounts.id, transactions.accountId))
        .where(inArray(transactions.importHash, lookupHashes))
    : [];
  const existingByHash = new Map(existing.map((e) => [e.importHash, e]));

  // For the heuristic layer, fetch every transaction whose (date, amount)
  // matches any new row. Skip rows whose date didn't parse to ISO YYYY-MM-DD
  // — they're never going to match anything in the DB anyway, and feeding a
  // malformed date into a `::date` cast would 22008 the whole query.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const heuristicCandidates = rows.filter((r) => ISO_DATE.test(r.date));
  // Pull every existing row whose date matches any new row, then JS-filter
  // by the (date, amount) tuple. SQLite stores amounts as text, so we
  // canonicalise both sides via parseFloat(...).toFixed(2) to match across
  // "12" vs "12.00" vs "12.000" forms.
  const heuristicHits = await (async () => {
    if (heuristicCandidates.length === 0) return [];
    const wantedDates = Array.from(new Set(heuristicCandidates.map((r) => r.date)));
    const wantedKeys = new Set(
      heuristicCandidates.map((r) => `${r.date}|${parseFloat(r.amount).toFixed(2)}`),
    );
    const dbRows = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        payee: transactions.payee,
        normalizedPayee: transactions.normalizedPayee,
        categoryId: transactions.categoryId,
        accountId: transactions.accountId,
        accountName: accounts.name,
        type: transactions.type,
        balance: transactions.balance,
        postedSeq: transactions.postedSeq,
      })
      .from(transactions)
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(inArray(transactions.date, wantedDates));
    return dbRows
      .filter((r) =>
        wantedKeys.has(`${r.date}|${parseFloat(r.amount).toFixed(2)}`),
      )
      .map((r) => ({
        id: r.id,
        date: r.date,
        amount: r.amount,
        payee: r.payee,
        normalized_payee: r.normalizedPayee,
        category_id: r.categoryId,
        account_id: r.accountId,
        type: r.type,
        balance: r.balance,
        posted_seq: r.postedSeq,
        account_name: r.accountName,
      }));
  })();
  // Group candidates by (date, amount) so we can pick the best payee match
  // per row when multiple exist (e.g. two unrelated $35 transactions on
  // the same day in the same account).
  type HeurCandidate = {
    id: string;
    date: string;
    amount: string;
    payee: string | null;
    normalizedPayee: string | null;
    categoryId: string | null;
    accountId: string;
    accountName: string | null;
    type: string | null;
    balance: string | null;
    postedSeq: number | null;
  };
  const heuristicByKey = new Map<string, HeurCandidate[]>();
  for (const h of heuristicHits) {
    // Postgres returns numeric as e.g. "-50.00"; new rows already use
    // toFixed(2). Match by string equality on the canonical form.
    const canonicalAmount = parseFloat(h.amount).toFixed(2);
    const k = `${h.date}|${canonicalAmount}`;
    let arr = heuristicByKey.get(k);
    if (!arr) {
      arr = [];
      heuristicByKey.set(k, arr);
    }
    arr.push({
      id: h.id,
      date: h.date,
      amount: canonicalAmount,
      payee: h.payee,
      normalizedPayee: h.normalized_payee,
      categoryId: h.category_id,
      accountId: h.account_id,
      accountName: h.account_name,
      type: h.type,
      balance: h.balance,
      postedSeq: h.posted_seq,
    });
  }

  /** Word-set Jaccard similarity for normalised-payee comparison. Cheap,
   * doesn't need pg_trgm round-trips, and handles common AU bank patterns
   * ("LOAN PAYMENT" vs "LOAN PAYMENT WESTPAC") well enough to separate
   * actual same-transaction-different-format pairs from coincidentally-
   * same-amount transactions like TICKETS vs BIG W. */
  function payeeSimilarity(a: string | null | undefined, b: string | null | undefined): number {
    const wa = new Set((a ?? "").split(/\s+/).filter(Boolean));
    const wb = new Set((b ?? "").split(/\s+/).filter(Boolean));
    if (wa.size === 0 && wb.size === 0) return 1;
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter += 1;
    return inter / (wa.size + wb.size - inter);
  }
  const PAYEE_SIM_THRESHOLD = 0.5;

  type Match = {
    type: "exact" | "legacy" | "possible";
    /** transactions.id of the matched DB row. Needed for the
     * DB-side chain check that surfaces wrong intra-day posted_seq
     * order to the import-review UI. */
    id: string;
    date: string | null;
    amount: string | null;
    payee: string | null;
    categoryId: string | null;
    accountId: string | null;
    accountName: string | null;
    bankType: string | null;
    balance: string | null;
    postedSeq: number | null;
  };
  const claimedOldHashes = new Set<string>();
  const matchByImportHash = new Map<string, Match>();
  for (const r of rows) {
    const direct = existingByHash.get(r.importHash);
    if (direct) {
      matchByImportHash.set(r.importHash, {
        type: "exact",
        id: direct.id,
        date: direct.date,
        amount: direct.amount,
        payee: direct.payee,
        categoryId: direct.categoryId,
        accountId: direct.accountId,
        accountName: direct.accountName,
        bankType: direct.type,
        balance: direct.balance,
        postedSeq: direct.postedSeq,
      });
      continue;
    }
    const oh = oldImportHash(r);
    if (!claimedOldHashes.has(oh)) {
      const legacy = existingByHash.get(oh);
      if (legacy) {
        claimedOldHashes.add(oh);
        matchByImportHash.set(r.importHash, {
          type: "legacy",
          id: legacy.id,
          date: legacy.date,
          amount: legacy.amount,
          payee: legacy.payee,
          categoryId: legacy.categoryId,
          accountId: legacy.accountId,
          accountName: legacy.accountName,
          bankType: legacy.type,
          balance: legacy.balance,
          postedSeq: legacy.postedSeq,
        });
        continue;
      }
    }
    // Heuristic match: among existing rows with same (date, amount),
    // pick the one whose normalized_payee is most similar to this row's
    // normalized payee. Reject the match if the best similarity is
    // below the threshold so unrelated same-day same-amount rows don't
    // false-positive (e.g. TICKETS*VCE vs BIG W).
    const candidates = heuristicByKey.get(`${r.date}|${r.amount}`);
    if (candidates && candidates.length > 0) {
      const newPayee = normalizePayee(r.payee ?? "");
      let best: HeurCandidate | null = null;
      let bestSim = 0;
      for (const c of candidates) {
        const s = payeeSimilarity(newPayee, c.normalizedPayee);
        if (s > bestSim) {
          bestSim = s;
          best = c;
        }
      }
      if (best && bestSim >= PAYEE_SIM_THRESHOLD) {
        matchByImportHash.set(r.importHash, {
          type: "possible",
          id: best.id,
          date: best.date,
          amount: best.amount,
          payee: best.payee,
          categoryId: best.categoryId,
          accountId: best.accountId,
          accountName: best.accountName,
          bankType: best.type,
          balance: best.balance,
          postedSeq: best.postedSeq,
        });
      }
    }
  }

  // Pre-load category id+name+parent so we can build the full "Parent > Child"
  // path and disambiguate the half-dozen "Insurance" categories under
  // Caravan / Ford / Motorbike / Health.
  const cats = await db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories);
  const byId = new Map(cats.map((c) => [c.id, c]));
  function pathOf(id: string | null | undefined): string | null {
    if (!id) return null;
    const parts: string[] = [];
    let cur = byId.get(id);
    let depth = 0;
    while (cur && depth < 4) {
      parts.unshift(cur.name);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      depth++;
    }
    return parts.length ? parts.join(" › ") : null;
  }
  const catName = new Map(cats.map((c) => [c.id, pathOf(c.id) ?? c.name]));

  // Stage 1: explicit payee_rules (the high-priority override layer).
  const lookupItems = rows
    .filter((r) => r.payee)
    .map((r) => ({
      key: r.importHash,
      normalizedPayee: normalizePayee(r.payee),
      amount: parseFloat(r.amount),
    }))
    .filter((i) => i.normalizedPayee);
  const ruleHits = useRules
    ? await batchLookupPayeeRules(lookupItems)
    : new Map<string, string>();

  // Stage 2: trigram suggester for everything still uncategorised. Run with
  // top-5 neighbour detail so the UI can explain the choice.
  const stage2 = lookupItems.filter((i) => !ruleHits.has(i.key));
  const trigramHits = new Map<
    string,
    {
      categoryId: string;
      score: number;
      support: number;
      neighbours: Neighbour[];
      categoryRanges: CategoryRange[];
    }
  >();
  if (useTrigram) {
    // Single freq-map fetch shared by every row's match-payee derivation.
    const tokenFreq = await loadTokenFreq();
    // Pull every categorised, payee-tagged row once. We score in JS per
    // stage2 item against this shared candidate set — same scoring shape
    // as the suggester, just exposing the wider top-30 neighbourhood so
    // the UI can show why a category was picked. Single fetch beats one
    // query per row at SQLite latency.
    const trigramPool = await db
      .select({
        normalizedPayee: transactions.normalizedPayee,
        matchPayee: transactions.matchPayee,
        amount: transactions.amount,
        categoryId: transactions.categoryId,
      })
      .from(transactions)
      .where(
        and(
          isNotNull(transactions.categoryId),
          isNotNull(transactions.matchPayee),
        ),
      );
    // SEQUENTIAL — was Promise.all-mapped, which gave no real concurrency
    // (better-sqlite3 is synchronous; the event loop processes the work
    // serially anyway) but kept N copies of the candidate buffer alive
    // inside each in-flight `suggestCategoryByHistory()` call. Before
    // this fix, a 99 KB CSV with ~800 stage2 rows fan-out triggered
    // ~800 concurrent full-table scans of `transactions` AND held all
    // their result buffers in V8 memory at once — straight OOM kill on
    // the container. Sequential walk + reusing the already-loaded
    // `trigramPool` (passed in via the new preloadedCandidates arg)
    // cuts memory back to one pool's worth of rows for the whole import.
    for (const it of stage2) {
      const suggestion = await suggestCategoryByHistory(
        it.normalizedPayee,
        it.amount,
        tokenFreq,
        trigramPool,
      );
      if (!suggestion) continue;
      const queryMatch = deriveMatchPayee(it.normalizedPayee, tokenFreq) ?? "";
      if (!queryMatch) continue;
      // Top 30 nearest neighbours above the same 0.4 floor the suggester
      // uses, sorted by similarity desc.
      const scored = trigramPool
        .map((c) => ({
          normalized_payee: c.normalizedPayee ?? "",
          sim: trigramSimilarity(c.matchPayee ?? "", queryMatch),
          amount: parseFloat(c.amount),
          category_id: c.categoryId as string,
        }))
        .filter((n) => n.sim > 0.4);
      scored.sort((a, b) => b.sim - a.sim);
      const widePool = scored.slice(0, 30);

      // Per-category min/max derived from the same neighbourhood the
      // suggester scored over. ABS so signed amounts (expense rows are
      // negative) read as a clean magnitude range.
      const byCat = new Map<string, { support: number; min: number; max: number }>();
      for (const n of widePool) {
        const mag = Math.abs(n.amount);
        const cur = byCat.get(n.category_id);
        if (cur) {
          cur.support += 1;
          if (mag < cur.min) cur.min = mag;
          if (mag > cur.max) cur.max = mag;
        } else {
          byCat.set(n.category_id, { support: 1, min: mag, max: mag });
        }
      }
      const categoryRanges: CategoryRange[] = Array.from(byCat.entries())
        .map(([cid, v]) => ({
          categoryName: catName.get(cid) ?? null,
          support: v.support,
          minAmount: v.min,
          maxAmount: v.max,
          isPicked: cid === suggestion.categoryId,
        }))
        .sort((a, b) => Number(b.isPicked) - Number(a.isPicked) || b.support - a.support);

      trigramHits.set(it.key, {
        ...suggestion,
        neighbours: widePool.slice(0, 5).map((n) => ({
          normalizedPayee: n.normalized_payee,
          similarity: n.sim,
          amount: n.amount,
          categoryName: catName.get(n.category_id) ?? null,
        })),
        categoryRanges,
      });
    }
  }

  // Per-row account resolution. Tries the alias table, then the account-
  // number-last-4 column, and finally falls back to the heuristic-match's
  // accountId. Cached per (kind, value) so a multi-account file with 50
  // rows on the same Bank Account doesn't fire 50 identical alias lookups.
  const allAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts);
  const accountNameById = new Map(allAccounts.map((a) => [a.id, a.name]));
  const aliasCache = new Map<string, string | null>();
  const last4Cache = new Map<string, string | null>();

  type Resolution = {
    accountId: string | null;
    accountName: string | null;
    via: "alias" | "last4" | "heuristic-match" | null;
  };
  async function resolveRowAccount(
    bankAccountId: string | undefined,
    heuristicMatchAccountId: string | null,
  ): Promise<Resolution> {
    if (bankAccountId) {
      let aliasHit = aliasCache.get(bankAccountId);
      if (aliasHit === undefined) {
        aliasHit = await resolveAccountByAlias("bank-account", bankAccountId);
        aliasCache.set(bankAccountId, aliasHit);
      }
      if (aliasHit) {
        return { accountId: aliasHit, accountName: accountNameById.get(aliasHit) ?? null, via: "alias" };
      }
      let last4Hit = last4Cache.get(bankAccountId);
      if (last4Hit === undefined) {
        last4Hit = await resolveAccountByLast4(bankAccountId);
        last4Cache.set(bankAccountId, last4Hit);
      }
      if (last4Hit) {
        return { accountId: last4Hit, accountName: accountNameById.get(last4Hit) ?? null, via: "last4" };
      }
    }
    if (heuristicMatchAccountId) {
      return {
        accountId: heuristicMatchAccountId,
        accountName: accountNameById.get(heuristicMatchAccountId) ?? null,
        via: "heuristic-match",
      };
    }
    return { accountId: null, accountName: null, via: null };
  }

  const resolutionByImportHash = new Map<string, Resolution>();
  for (const r of rows) {
    const match = matchByImportHash.get(r.importHash);
    const bankAccountId = r.qifAccount?.name ?? undefined;
    resolutionByImportHash.set(
      r.importHash,
      await resolveRowAccount(bankAccountId, match?.accountId ?? null),
    );
  }

  // Balance reconciliation. The chain check is purely a file-integrity
  // signal — group rows by the file's own bank-account-id (NOT the
  // resolved app-account, which can route mistakenly via the heuristic
  // and break the chain), sort chronologically, and verify each row's
  // claimed balance equals previous_row.balance + this_row.amount.
  // Most files emit rows newest-first, so detect the file's direction
  // per-group and order same-date rows by file-index DESC in that case
  // so the chain walks bank-chronological.
  const balanceCheckByImportHash = new Map<
    string,
    {
      match: boolean;
      predicted: number;
      claimed: number;
      delta: number;
      mode: "chain" | "anchor";
    }
  >();

  // Group by bank-account-id (or "_single_" when the file has no per-row
  // account context). Capture the file index so we can detect the file's
  // intra-day ordering convention without losing it during the date sort.
  const balanceRowsByBankId = new Map<
    string,
    {
      fileIndex: number;
      importHash: string;
      date: string;
      amount: string;
      runningBalance: string;
      resolvedAccountId: string | null;
    }[]
  >();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.runningBalance) continue;
    const bankId = r.qifAccount?.name?.trim() || "_single_";
    let arr = balanceRowsByBankId.get(bankId);
    if (!arr) {
      arr = [];
      balanceRowsByBankId.set(bankId, arr);
    }
    arr.push({
      fileIndex: i,
      importHash: r.importHash,
      date: r.date,
      amount: r.amount,
      runningBalance: r.runningBalance,
      resolvedAccountId: resolutionByImportHash.get(r.importHash)?.accountId ?? null,
    });
  }

  // For the anchor check we need DB starting-balance + per-account
  // strictly-before sums. Pull them once for any resolved app-account
  // that corresponds to a first-chronological row.
  const anchorAccountIds = new Set<string>();
  for (const group of balanceRowsByBankId.values()) {
    for (const r of group) {
      if (r.resolvedAccountId) anchorAccountIds.add(r.resolvedAccountId);
    }
  }
  const dbTxnsByAccount = new Map<string, { date: string; amount: number }[]>();
  const dbDatesByAccount = new Map<string, Set<string>>();
  const startingByAccount = new Map<string, number>();
  if (anchorAccountIds.size > 0) {
    const accountIdList = Array.from(anchorAccountIds);
    const dbTxns = await db
      .select({
        accountId: transactions.accountId,
        date: transactions.date,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(inArray(transactions.accountId, accountIdList));
    const accountRows = await db
      .select({ id: accounts.id, startingBalance: accounts.startingBalance })
      .from(accounts)
      .where(inArray(accounts.id, accountIdList));
    for (const a of accountRows) startingByAccount.set(a.id, parseFloat(a.startingBalance));
    for (const aId of accountIdList) {
      dbTxnsByAccount.set(aId, []);
      dbDatesByAccount.set(aId, new Set());
    }
    for (const t of dbTxns) {
      dbTxnsByAccount.get(t.accountId)!.push({ date: t.date, amount: parseFloat(t.amount) });
      dbDatesByAccount.get(t.accountId)!.add(t.date);
    }
    for (const arr of dbTxnsByAccount.values()) {
      arr.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  function sumStrictlyBefore(accountId: string, date: string): number {
    const arr = dbTxnsByAccount.get(accountId) ?? [];
    let s = startingByAccount.get(accountId) ?? 0;
    for (const t of arr) {
      if (t.date < date) s += t.amount;
      else break;
    }
    return s;
  }

  for (const [, group] of balanceRowsByBankId) {
    if (group.length === 0) continue;
    // Detect file direction: if first file row's date is later than the
    // last's, the bank emits newest-first. Within same date, order by file
    // index DESC so the chain still walks chronologically. Oldest-first
    // files get the natural ASC ordering.
    const firstFileDate = group[0].date;
    const lastFileDate = group[group.length - 1].date;
    const isNewestFirst = firstFileDate > lastFileDate;
    group.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return isNewestFirst ? b.fileIndex - a.fileIndex : a.fileIndex - b.fileIndex;
    });
    let prevBalance: number | null = null;
    for (const r of group) {
      const claimed = parseFloat(r.runningBalance);
      const amt = parseFloat(r.amount);
      if (!Number.isFinite(claimed) || !Number.isFinite(amt)) continue;
      if (prevBalance != null) {
        const predicted = prevBalance + amt;
        const delta = +(claimed - predicted).toFixed(2);
        balanceCheckByImportHash.set(r.importHash, {
          match: Math.abs(delta) < 0.01,
          predicted: +predicted.toFixed(2),
          claimed: +claimed.toFixed(2),
          delta,
          mode: "chain",
        });
      } else if (r.resolvedAccountId) {
        // First chronological row in the group — anchor check, only when
        // the row's date has no DB transactions (otherwise intra-day
        // ordering between this row and DB rows is ambiguous).
        const ambiguous = dbDatesByAccount.get(r.resolvedAccountId)?.has(r.date) ?? false;
        if (!ambiguous) {
          const claimedPre = +(claimed - amt).toFixed(2);
          const expectedPre = sumStrictlyBefore(r.resolvedAccountId, r.date);
          const delta = +(claimedPre - expectedPre).toFixed(2);
          balanceCheckByImportHash.set(r.importHash, {
            match: Math.abs(delta) < 0.01,
            predicted: +expectedPre.toFixed(2),
            claimed: claimedPre,
            delta,
            mode: "anchor",
          });
        }
      }
      prevBalance = claimed;
    }
  }

  // DB-side chain check. For every duplicate-matched row we walk the
  // EXISTING DB chain in `(date, posted_seq, posted_at|created_at,
  // id)` order — same tuple the running-balance subquery in
  // /api/transactions uses — and compare each DB row's stored bank
  // balance to the chain-predicted value. A mismatch on a row that
  // does have a stored balance means the existing `posted_seq`
  // ordering doesn't reproduce what the bank claimed — i.e. the
  // intra-day order is wrong.
  //
  // The check intentionally does NOT gate on the new file's
  // runningBalance: even a CSV without a Balance column still
  // identifies WHICH DB row to flag via importHash, and the DB's
  // own stored balance (from whatever import originally set it)
  // is enough to detect the mismatch. Only the auto-correction
  // path in commit-batched needs a file-supplied balance.
  const dbChainCheckByImportHash = new Map<
    string,
    { match: boolean; expected: number; claimed: number; delta: number }
  >();
  {
    const accountIdsForChain = new Set<string>();
    for (const r of rows) {
      const m = matchByImportHash.get(r.importHash);
      if (m?.accountId) accountIdsForChain.add(m.accountId);
    }
    if (accountIdsForChain.size > 0) {
      const accountIdList = Array.from(accountIdsForChain);
      const dbRows = await db
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          amount: transactions.amount,
          balance: transactions.balance,
        })
        .from(transactions)
        .where(inArray(transactions.accountId, accountIdList))
        .orderBy(
          asc(transactions.date),
          asc(sql`COALESCE(${transactions.postedSeq}, 0)`),
          asc(
            sql`COALESCE(${transactions.postedAt}, ${transactions.createdAt})`,
          ),
          asc(transactions.id),
        );
      const accountRows = await db
        .select({ id: accounts.id, startingBalance: accounts.startingBalance })
        .from(accounts)
        .where(inArray(accounts.id, accountIdList));
      const startingByAccountId = new Map(
        accountRows.map((a) => [a.id, parseFloat(a.startingBalance)]),
      );
      // dbRowId → {expected, stored} after the chain walk.
      const chainByDbRowId = new Map<
        string,
        { expected: number; claimed: number }
      >();
      const running = new Map<string, number>();
      for (const id of accountIdList) {
        running.set(id, startingByAccountId.get(id) ?? 0);
      }
      for (const t of dbRows) {
        const prev = running.get(t.accountId) ?? 0;
        const next = prev + parseFloat(t.amount);
        if (t.balance != null) {
          const claimed = parseFloat(t.balance);
          if (Number.isFinite(claimed)) {
            chainByDbRowId.set(t.id, {
              expected: +next.toFixed(2),
              claimed: +claimed.toFixed(2),
            });
          }
        }
        running.set(t.accountId, next);
      }
      // Project DB-row chain results onto the file rows via the
      // matched id. Emit for any duplicate-matched row whose DB
      // record has a stored balance — the new file's runningBalance
      // isn't required since `claimed` here is the DB's stored
      // balance, not the file's.
      for (const r of rows) {
        const m = matchByImportHash.get(r.importHash);
        if (!m) continue;
        const c = chainByDbRowId.get(m.id);
        if (!c) continue;
        const delta = +(c.claimed - c.expected).toFixed(2);
        dbChainCheckByImportHash.set(r.importHash, {
          match: Math.abs(delta) < 0.01,
          expected: c.expected,
          claimed: c.claimed,
          delta,
        });
      }
    }
  }

  const out: TestResultRow[] = rows.map((r) => {
    const normalized = r.payee ? normalizePayee(r.payee) : "";
    const ruleCat = ruleHits.get(r.importHash) ?? null;
    const trigramHit = trigramHits.get(r.importHash) ?? null;

    let method: TestResultRow["method"] = "none";
    let categoryId: string | null = null;
    let extra: Partial<TestResultRow> = {};
    if (ruleCat) {
      method = "rule";
      categoryId = ruleCat;
    } else if (trigramHit) {
      method = "trigram";
      categoryId = trigramHit.categoryId;
      extra = {
        score: trigramHit.score,
        support: trigramHit.support,
        neighbours: trigramHit.neighbours,
        categoryRanges: trigramHit.categoryRanges,
      };
    }

    const match = matchByImportHash.get(r.importHash);
    const resolution = resolutionByImportHash.get(r.importHash) ?? {
      accountId: null,
      accountName: null,
      via: null,
    };
    // Folded "type" — whichever the format provides. Stored verbatim on
    // transactions.type at commit time; surfaced here so the user can
    // verify against the existing record's type.
    const resolvedType = r.trnType ?? r.bankCategory ?? null;
    return {
      date: r.date,
      amount: r.amount,
      payee: r.payee,
      normalizedPayee: normalized,
      // Identifiers — the importHash is what dedupe machinery (both
      // server-side and the client commit panel) uses to map rows to
      // existing records, and rawId is what /api/import/commit-batched
      // uses verbatim so it doesn't accidentally re-hash with a
      // fabricated id.
      importHash: r.importHash,
      rawId: r.rawId,
      method,
      categoryId,
      categoryName: categoryId ? catName.get(categoryId) ?? null : null,
      matchType: match?.type,
      existingDate: match?.date ?? null,
      existingAmount: match?.amount ?? null,
      existingPayee: match?.payee ?? null,
      existingCategoryName: match?.categoryId ? catName.get(match.categoryId) ?? null : null,
      existingAccountName: match?.accountName ?? null,
      existingType: match?.bankType ?? null,
      existingBalance: match?.balance ?? null,
      existingPostedSeq: match?.postedSeq ?? null,
      balanceCheck: balanceCheckByImportHash.get(r.importHash),
      balanceCheckVsDB: dbChainCheckByImportHash.get(r.importHash),
      resolvedType,
      resolvedAccountId: resolution.accountId,
      resolvedAccountName: resolution.accountName,
      resolvedAccountVia: resolution.via,
      ...extra,
      // Format-specific enrichment passed through so the UI can show
      // the user what extra data each format actually carries.
      qifAccount: r.qifAccount,
      qifSectionType: r.qifSectionType,
      checkNum: r.checkNum,
      cleared: r.cleared,
      bankCategory: r.bankCategory,
      address: r.address,
      splits: r.splits,
      trnType: r.trnType,
      refNum: r.refNum,
      runningBalance: r.runningBalance,
      postedSeq: r.postedSeq ?? null,
    };
  });

  // Account-context summary: count rows per declared account so a
  // multi-account file is obvious at a glance. Populated for both QIF
  // (`!Account` blocks) and CSV (a "Bank Account" column). Single-account
  // files with no account context yield an empty array — caller hides the
  // section.
  const qifAccountSummary: { name: string; type?: string; count: number }[] = [];
  {
    const byAcct = new Map<string, { name: string; type?: string; count: number }>();
    for (const r of out) {
      const name = r.qifAccount?.name ?? "";
      if (!name) continue;
      const cur = byAcct.get(name);
      if (cur) cur.count += 1;
      else byAcct.set(name, { name, type: r.qifAccount?.type, count: 1 });
    }
    qifAccountSummary.push(...byAcct.values());
  }

  // How rich is each format? Quick stat counters so the user can compare
  // QIF vs OFX against the same source bank without expanding every row.
  const fieldStats = {
    withBankCategory: out.filter((r) => !!r.bankCategory).length,
    withCheckNum: out.filter((r) => !!r.checkNum).length,
    withCleared: out.filter((r) => !!r.cleared).length,
    withSplits: out.filter((r) => r.splits && r.splits.length > 0).length,
    withTrnType: out.filter((r) => !!r.trnType).length,
    withRefNum: out.filter((r) => !!r.refNum).length,
    withRunningBalance: out.filter((r) => !!r.runningBalance).length,
  };

  return NextResponse.json({
    format,
    total: out.length,
    summary: {
      rule: out.filter((r) => r.method === "rule").length,
      trigram: out.filter((r) => r.method === "trigram").length,
      none: out.filter((r) => r.method === "none").length,
    },
    matchSummary: {
      newRows: out.filter((r) => !r.matchType).length,
      exact: out.filter((r) => r.matchType === "exact").length,
      legacy: out.filter((r) => r.matchType === "legacy").length,
      possible: out.filter((r) => r.matchType === "possible").length,
    },
    ofxMeta,
    qifAccountSummary,
    fieldStats,
    rows: out,
  });
});
