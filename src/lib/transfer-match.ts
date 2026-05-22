import { db } from "@/db";
import {
  accounts,
  transactions,
  transferSuggestions,
  dismissedTransferPairs,
  categories,
} from "@/db/schema";
import { sql, eq, and, isNull, inArray, or } from "drizzle-orm";

/**
 * Scoring constants. Auto-pair fires when a candidate scores AUTO_THRESHOLD or
 * higher; below that the candidate is recorded in `transfer_suggestions` for
 * the user to confirm or dismiss.
 *
 * The strong signals (account name, last4, shared reference token) each push
 * a candidate over the threshold by themselves; pure inverse-amount + close-
 * date alone does not.
 */
export const MAX_DATE_GAP_DAYS = 3;
export const AUTO_THRESHOLD = 5;
const SUGGEST_THRESHOLD = 1;

export type TransferKind = "none" | "internal" | "external";

export type CandidateRow = {
  a_id: string;
  b_id: string;
  a_payee: string | null;
  b_payee: string | null;
  a_account_name: string;
  b_account_name: string;
  a_account_last4: string | null;
  b_account_last4: string | null;
  a_account_type: string;
  b_account_type: string;
  a_transfer_kind: TransferKind;
  b_transfer_kind: TransferKind;
  a_category_id: string | null;
  b_category_id: string | null;
  date_gap: number;
  /** Bank-supplied posting order (NULL when the import format didn't
   *  include it). Lower = earlier in the statement. */
  a_posted_seq: number | null;
  b_posted_seq: number | null;
  /** Bank-supplied posting timestamp (ms epoch). NULL when missing. */
  a_posted_at: number | null;
  b_posted_at: number | null;
  /** Row insert time — always present, used as the final fallback. */
  a_created_at: number;
  b_created_at: number;
};

function tokensFromPayee(p: string | null): Set<string> {
  if (!p) return new Set();
  const upper = p.toUpperCase();
  const matches = upper.match(/[A-Z0-9]{6,}/g) ?? [];
  return new Set(matches);
}

function payeeMentions(payee: string | null, needle: string | null): boolean {
  if (!payee || !needle) return false;
  return payee.toUpperCase().includes(needle.toUpperCase());
}

/**
 * Lenient account-name match: bank statements truncate friendly names ("TFR
 * Caravan Loa"), so we also accept any significant (≥5-char) word from the
 * account name appearing in the payee. "Bills" → ["BILLS"]; "Caravan Loan" →
 * ["CARAVAN"]. Single-word accounts shorter than 5 chars fall back to the
 * full-name `payeeMentions` check.
 */
function payeeMentionsAccount(payee: string | null, accountName: string): boolean {
  if (!payee) return false;
  if (payeeMentions(payee, accountName)) return true;
  const upper = payee.toUpperCase();
  const words = accountName.toUpperCase().split(/\s+/).filter((w) => w.length >= 5);
  return words.some((w) => upper.includes(w));
}

// Exported for tests. The scoring rules are hand-tuned and a regression
// here silently mis-pairs money movements between accounts.
export function scoreCandidate(c: CandidateRow): number {
  let score = 0;

  if (c.date_gap === 0) score += 1;
  else if (c.date_gap === 2) score -= 1;
  else if (c.date_gap === 3) score -= 2;

  if (
    payeeMentionsAccount(c.a_payee, c.b_account_name) ||
    payeeMentionsAccount(c.b_payee, c.a_account_name)
  ) {
    score += 5;
  }

  if (
    payeeMentions(c.a_payee, c.b_account_last4) ||
    payeeMentions(c.b_payee, c.a_account_last4)
  ) {
    score += 5;
  }

  const aTokens = tokensFromPayee(c.a_payee);
  const bTokens = tokensFromPayee(c.b_payee);
  for (const t of aTokens) {
    if (bTokens.has(t)) {
      score += 3;
      break;
    }
  }

  // "Both halves already in a linked-class category" — any non-'none' kind
  // (internal moves OR external loan/credit payments) signals the user has
  // told us these are cross-account flows. The two kinds split on reporting
  // semantics, not pairing semantics.
  const aLinked = c.a_transfer_kind !== "none";
  const bLinked = c.b_transfer_kind !== "none";
  if (aLinked && bLinked) score += 2;

  // Exactly one side lives on a loan/credit account: those accounts only
  // receive money via cross-account transfers (interest, fees etc. don't have
  // an inverse counterpart on a liquid account), so an inverse-amount
  // same-day candidate is essentially definitive — even when the bank's
  // payee text on the source side names the wrong destination account.
  const aIsLoan = isLoanLike(c.a_account_type) !== null;
  const bIsLoan = isLoanLike(c.b_account_type) !== null;
  if (aIsLoan !== bIsLoan) score += 3;

  return score;
}

function isLoanLike(accountType: string): "loan" | "credit" | null {
  if (accountType === "loan") return "loan";
  if (accountType === "credit") return "credit";
  return null;
}

/**
 * Tiebreaker for candidates that tie on score AND date-gap (i.e. multiple
 * same-day same-amount transfers competing for the same other-side legs).
 * Smaller return value = more likely to be the actual pair.
 *
 * Strategy: rank by how close the two halves are in the bank's posting
 * order. When the bank posts "checking debit #1 → checking debit #2 →
 * savings credit → brokerage credit" on the same day, the matched legs
 * (debit #1 ↔ savings credit) tend to live adjacent in posted_seq; the
 * cross-pair (debit #1 ↔ brokerage credit) is farther apart.
 *
 * Fallback chain: `postedSeq` (set by every modern import path), then
 * `postedAt` (older imports), then `createdAt` (always present). Each
 * tier's distance is on its own numeric scale, so we'd never mix tiers;
 * we pick whichever tier BOTH halves have populated.
 *
 * Exported for tests.
 */
export function tiebreakDistance(c: CandidateRow): number {
  if (c.a_posted_seq !== null && c.b_posted_seq !== null) {
    return Math.abs(c.a_posted_seq - c.b_posted_seq);
  }
  if (c.a_posted_at !== null && c.b_posted_at !== null) {
    return Math.abs(c.a_posted_at - c.b_posted_at);
  }
  return Math.abs(c.a_created_at - c.b_created_at);
}

export interface PairResult {
  paired: number;
  suggested: number;
}

interface PairOpts {
  /** Inclusive ISO date (YYYY-MM-DD). If omitted, scan whole table. */
  since?: string;
  /** Inclusive ISO date (YYYY-MM-DD). If omitted, scan whole table. */
  until?: string;
}

/**
 * Find candidate transfer pairs in the given window and either auto-link them
 * or stash them as suggestions. Idempotent — only considers rows where
 * `transfer_pair_id IS NULL`, and only inserts suggestion rows that don't
 * already exist.
 */
export async function pairTransfersInWindow(opts: PairOpts = {}): Promise<PairResult> {
  // The caller is expected to have already padded the window by
  // MAX_DATE_GAP_DAYS on both sides, so we can apply the same bounds to both
  // halves of the candidate pair. The ABS(date) proximity check handles the
  // intra-pair gap; we don't need extra padding inside the SQL.
  const sinceClause = opts.since
    ? sql`AND t1.date >= ${opts.since} AND t2.date >= ${opts.since}`
    : sql``;
  const untilClause = opts.until
    ? sql`AND t1.date <= ${opts.until} AND t2.date <= ${opts.until}`
    : sql``;

  // Pull every candidate pair (both halves still unpaired, inverse amount,
  // different account, ≤ MAX_DATE_GAP_DAYS apart). Amounts are stored as
  // TEXT in SQLite, so cast to REAL for the inverse-amount comparison.
  // Dates are TEXT (YYYY-MM-DD) — julianday() converts them to a numeric
  // day count for the proximity check. Booleans come back as 0/1; we
  // coerce to JS booleans below.
  const rawRows = (await db.all(sql`
    SELECT
      t1.id                      AS a_id,
      t2.id                      AS b_id,
      t1.payee                   AS a_payee,
      t2.payee                   AS b_payee,
      a1.name                    AS a_account_name,
      a2.name                    AS b_account_name,
      a1.account_number_last4    AS a_account_last4,
      a2.account_number_last4    AS b_account_last4,
      a1.type                    AS a_account_type,
      a2.type                    AS b_account_type,
      COALESCE(c1.transfer_kind, 'none') AS a_transfer_kind,
      COALESCE(c2.transfer_kind, 'none') AS b_transfer_kind,
      t1.category_id             AS a_category_id,
      t2.category_id             AS b_category_id,
      ABS(julianday(t1.date) - julianday(t2.date)) AS date_gap,
      t1.posted_seq              AS a_posted_seq,
      t2.posted_seq              AS b_posted_seq,
      t1.posted_at               AS a_posted_at,
      t2.posted_at               AS b_posted_at,
      t1.created_at              AS a_created_at,
      t2.created_at              AS b_created_at
    FROM transactions t1
    JOIN transactions t2
      ON t2.id > t1.id
     AND t2.account_id <> t1.account_id
     AND CAST(t2.amount AS REAL) = -CAST(t1.amount AS REAL)
     AND ABS(julianday(t2.date) - julianday(t1.date)) <= ${MAX_DATE_GAP_DAYS}
     AND t2.transfer_pair_id IS NULL
    JOIN accounts a1 ON a1.id = t1.account_id
    JOIN accounts a2 ON a2.id = t2.account_id
    LEFT JOIN categories c1 ON c1.id = t1.category_id
    LEFT JOIN categories c2 ON c2.id = t2.category_id
    WHERE t1.transfer_pair_id IS NULL
    ${sinceClause}
    ${untilClause}
  `)) as unknown as Array<{
    a_id: string;
    b_id: string;
    a_payee: string | null;
    b_payee: string | null;
    a_account_name: string;
    b_account_name: string;
    a_account_last4: string | null;
    b_account_last4: string | null;
    a_account_type: string;
    b_account_type: string;
    a_transfer_kind: string;
    b_transfer_kind: string;
    a_category_id: string | null;
    b_category_id: string | null;
    date_gap: number;
    a_posted_seq: number | null;
    b_posted_seq: number | null;
    a_posted_at: number | null;
    b_posted_at: number | null;
    a_created_at: number;
    b_created_at: number;
  }>;
  const asKind = (v: string): TransferKind =>
    v === "internal" || v === "external" ? v : "none";
  const rows: CandidateRow[] = rawRows.map((r) => ({
    ...r,
    a_transfer_kind: asKind(r.a_transfer_kind),
    b_transfer_kind: asKind(r.b_transfer_kind),
  }));

  // Resolve the system "Loan Payment" / "Credit Payment" categories once so
  // we can auto-assign them when a paired counterpart lives on a loan/credit
  // account and the source side is currently uncategorised. These ship as
  // top-level `transferKind = 'external'` categories (migrated from the
  // legacy isPayment flag in drizzle/0005_transfer_kind.sql).
  const paymentCats = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(and(eq(categories.transferKind, "external"), isNull(categories.parentId)));
  const loanPaymentCatId = paymentCats.find((c) => c.name === "Loan Payment")?.id ?? null;
  const creditPaymentCatId = paymentCats.find((c) => c.name === "Credit Payment")?.id ?? null;
  const candidateById = new Map<string, CandidateRow>();
  for (const r of rows) {
    candidateById.set(`${r.a_id}|${r.b_id}`, r);
  }

  // Score every candidate. Group by each transaction id so we can pick the
  // best counterpart per side and detect ambiguity.
  //
  // `tiebreak` is the posted-order distance between the two halves
  // (see `tiebreakDistance`). It's the third sort key after score/gap
  // and exists to disambiguate the multiple-same-day-same-amount
  // collision where two correct pairs and two cross-pairs all tie on
  // score+gap; the bank's posting order resolves the assignment.
  type Scored = {
    aId: string;
    bId: string;
    score: number;
    gap: number;
    tiebreak: number;
  };
  const scored: Scored[] = rows.map((r) => ({
    aId: r.a_id,
    bId: r.b_id,
    score: scoreCandidate(r),
    gap: Number(r.date_gap),
    tiebreak: tiebreakDistance(r),
  }));

  const byTxn = new Map<string, Scored[]>();
  for (const s of scored) {
    (byTxn.get(s.aId) ?? byTxn.set(s.aId, []).get(s.aId)!).push(s);
    (byTxn.get(s.bId) ?? byTxn.set(s.bId, []).get(s.bId)!).push(s);
  }

  /**
   * Best LIVE candidate for `id` — i.e. ignore candidates whose other side
   * is already in `taken`. This is what makes the four-way same-day
   * same-amount collision resolvable: once the outer greedy commits the
   * first correct pair, the cross-pair candidates' other halves become
   * unavailable and the remaining transactions' ambiguity collapses
   * naturally. Without this filter, `bestFor` looks at the original
   * candidate list and keeps returning null because of ties on dead
   * candidates.
   */
  function bestFor(id: string, taken: Set<string>): Scored | null {
    const list = byTxn.get(id);
    if (!list || list.length === 0) return null;
    const live = list.filter((s) => {
      const otherId = s.aId === id ? s.bId : s.aId;
      return !taken.has(otherId);
    });
    if (live.length === 0) return null;
    const sorted = live.sort(
      (x, y) => y.score - x.score || x.gap - y.gap || x.tiebreak - y.tiebreak,
    );
    const top = sorted[0];
    // Ambiguity only when the top-2 LIVE candidates tie on ALL THREE
    // sort dimensions. Two genuinely indistinguishable candidates
    // (same score, same gap, same posted-order distance) defer to
    // suggestions.
    if (sorted.length > 1) {
      const second = sorted[1];
      if (
        second.score === top.score &&
        second.gap === top.gap &&
        second.tiebreak === top.tiebreak
      ) {
        return null;
      }
    }
    return top;
  }

  let paired = 0;
  let suggested = 0;
  const taken = new Set<string>();
  const suggestionPairs: Scored[] = [];

  for (const cand of [...scored].sort(
    (x, y) => y.score - x.score || x.gap - y.gap || x.tiebreak - y.tiebreak,
  )) {
    if (cand.score < AUTO_THRESHOLD) {
      if (cand.score >= SUGGEST_THRESHOLD) suggestionPairs.push(cand);
      continue;
    }
    if (taken.has(cand.aId) || taken.has(cand.bId)) continue;
    if (bestFor(cand.aId, taken)?.bId !== cand.bId) continue;
    if (bestFor(cand.bId, taken)?.aId !== cand.aId) continue;

    // Look up account types and current categoryIds from the row we already
    // hydrated, so we can auto-assign a payment category when the pair
    // straddles a liquid → loan/credit boundary.
    const row = candidateById.get(`${cand.aId}|${cand.bId}`);
    const aLoanType = row ? isLoanLike(row.a_account_type) : null;
    const bLoanType = row ? isLoanLike(row.b_account_type) : null;
    let aPatchCategoryId: string | undefined;
    let bPatchCategoryId: string | undefined;
    // Only one side should be a loan/credit account. Apply the corresponding
    // payment category to the *non-loan* side when it's currently uncategorised.
    if (row) {
      if (bLoanType && !aLoanType && row.a_category_id === null) {
        const targetId = bLoanType === "loan" ? loanPaymentCatId : creditPaymentCatId;
        if (targetId) aPatchCategoryId = targetId;
      }
      if (aLoanType && !bLoanType && row.b_category_id === null) {
        const targetId = aLoanType === "loan" ? loanPaymentCatId : creditPaymentCatId;
        if (targetId) bPatchCategoryId = targetId;
      }
    }

    // Issue #60: re-assert `transfer_pair_id IS NULL` on both UPDATEs.
    // Without it, a concurrent manualPair (or another matcher run)
    // landing between the SELECT and these UPDATEs would clobber the
    // other side's pair pointer, leaving a half-paired leg. Abort the
    // pair (transaction rollback) if either UPDATE affected zero rows.
    const pairOk = await db.transaction(async (tx) => {
      const aRes = await tx
        .update(transactions)
        .set({
          transferPairId: cand.bId,
          ...(aPatchCategoryId ? { categoryId: aPatchCategoryId } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(transactions.id, cand.aId), isNull(transactions.transferPairId)),
        )
        .returning({ id: transactions.id });
      if (aRes.length === 0) {
        throw new Error("transfer-pair race: aId already paired");
      }
      const bRes = await tx
        .update(transactions)
        .set({
          transferPairId: cand.aId,
          ...(bPatchCategoryId ? { categoryId: bPatchCategoryId } : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(transactions.id, cand.bId), isNull(transactions.transferPairId)),
        )
        .returning({ id: transactions.id });
      if (bRes.length === 0) {
        throw new Error("transfer-pair race: bId already paired");
      }
      await tx.run(sql`
        DELETE FROM transfer_suggestions
        WHERE transaction_id IN (${cand.aId}, ${cand.bId})
           OR candidate_id   IN (${cand.aId}, ${cand.bId})
      `);
      return true;
    }).catch(() => false);
    if (!pairOk) {
      // Race or stale-candidate: skip this pair and let the next run
      // re-evaluate fresh state. Don't count it as paired.
      continue;
    }
    taken.add(cand.aId);
    taken.add(cand.bId);
    paired++;
  }

  // Pull the dismissed-pair set once so the per-suggestion loop is
  // O(1) lookup instead of an `IN (...)` per row. Pairs are stored
  // in canonical (a < b) order — same order as `suggestionPairs`.
  const dismissedRows = await db
    .select({
      transactionId: dismissedTransferPairs.transactionId,
      candidateId: dismissedTransferPairs.candidateId,
    })
    .from(dismissedTransferPairs);
  const dismissedSet = new Set(
    dismissedRows.map((r) => `${r.transactionId}|${r.candidateId}`),
  );

  // Suggestions: insert one row per candidate pair (transaction_id < candidate_id),
  // skip pairs whose halves are now paired OR whose pair sits in
  // `dismissed_transfer_pairs` (the sticky "no, never suggest this
  // again" signal).
  for (const s of suggestionPairs) {
    if (taken.has(s.aId) || taken.has(s.bId)) continue;
    if (dismissedSet.has(`${s.aId}|${s.bId}`)) continue;
    const result = await db
      .insert(transferSuggestions)
      .values({ transactionId: s.aId, candidateId: s.bId, score: s.score })
      .onConflictDoNothing({
        target: [transferSuggestions.transactionId, transferSuggestions.candidateId],
      })
      .returning({ id: transferSuggestions.id });
    if (result.length > 0) suggested++;
  }

  return { paired, suggested };
}

/**
 * Manually link two transactions as a transfer pair. Sets `transfer_pair_id`
 * symmetrically and clears any suggestions referencing either side.
 */
export async function manualPair(aId: string, bId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Issue #46: validate that the pair is meaningful — different
    // accounts AND opposing-sign amounts that cancel within a cent.
    // Auto-pairing's SQL enforces both; manual pairing accepted
    // anything. Nonsensical pairs subsequently confuse asset-pool
    // netting, transfer-aware reports, and the orphan backfill.
    const rows = await tx
      .select({
        id: transactions.id,
        accountId: transactions.accountId,
        amount: transactions.amount,
        pairId: transactions.transferPairId,
      })
      .from(transactions)
      .where(inArray(transactions.id, [aId, bId]));
    const aRow = rows.find((r) => r.id === aId);
    const bRow = rows.find((r) => r.id === bId);
    if (!aRow || !bRow) {
      throw new Error(`manualPair: transaction ${!aRow ? aId : bId} not found`);
    }
    if (aRow.accountId === bRow.accountId) {
      throw new Error(
        "manualPair: both transactions are on the same account — transfers move between accounts.",
      );
    }
    const sumCents = Math.round(
      (parseFloat(aRow.amount) + parseFloat(bRow.amount)) * 100,
    );
    if (Math.abs(sumCents) > 1) {
      throw new Error(
        `manualPair: amounts must cancel (got ${aRow.amount} + ${bRow.amount}).`,
      );
    }
    // Clear any pre-existing pairs first so we don't orphan a third row.
    // Issue #59: if the displaced counterpart is a synthetic stub
    // minted by manualPairExternal, DELETE it instead of just nulling
    // — orphan synthetics with no pair point to nowhere and clutter
    // the External account indefinitely. After delete/null, recompute
    // the affected accounts' currentBalance via the standard pattern.
    const pairsToClear = rows
      .map((r) => r.pairId)
      .filter((p): p is string => !!p && p !== aId && p !== bId);
    const accountsToRecompute = new Set<string>();
    for (const pid of pairsToClear) {
      const [partner] = await tx
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          isSynthetic: transactions.isSynthetic,
        })
        .from(transactions)
        .where(eq(transactions.id, pid));
      if (!partner) continue;
      if (partner.isSynthetic) {
        await tx
          .delete(transactions)
          .where(eq(transactions.id, partner.id));
        accountsToRecompute.add(partner.accountId);
      } else {
        await tx
          .update(transactions)
          .set({ transferPairId: null, updatedAt: new Date() })
          .where(eq(transactions.id, pid));
      }
    }
    if (accountsToRecompute.size > 0) {
      for (const accountId of accountsToRecompute) {
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`(SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${accountId}) + ${accounts.startingBalance}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, accountId));
      }
    }
    await tx
      .update(transactions)
      .set({ transferPairId: bId, updatedAt: new Date() })
      .where(eq(transactions.id, aId));
    await tx
      .update(transactions)
      .set({ transferPairId: aId, updatedAt: new Date() })
      .where(eq(transactions.id, bId));
    await tx
      .delete(transferSuggestions)
      .where(
        or(
          inArray(transferSuggestions.transactionId, [aId, bId]),
          inArray(transferSuggestions.candidateId, [aId, bId]),
        ),
      );
    // If the user once dismissed this exact pair and is now
    // explicitly linking it, drop the dismissal so the record
    // reflects current intent. (The matcher won't re-suggest it
    // either way because both halves now carry `transfer_pair_id`,
    // but a stale dismissal row is just clutter.)
    await tx
      .delete(dismissedTransferPairs)
      .where(
        or(
          inArray(dismissedTransferPairs.transactionId, [aId, bId]),
          inArray(dismissedTransferPairs.candidateId, [aId, bId]),
        ),
      );
  });
}

/**
 * Pair a transaction with a SYNTHETIC counterpart inside a named external
 * (untracked) account. Used when the user clicks "Link as transfer" but
 * the other leg of the transfer lives somewhere we don't import (e.g. a
 * separate bank, a family member's account, PayPal). The external account
 * is found-or-created by case-insensitive name match; a stub transaction
 * with `is_synthetic=true` is inserted to stand in for the missing leg;
 * both rows are then linked via `transfer_pair_id`.
 *
 * The synthetic stub holds the OPPOSITE sign of the source amount, the
 * same date, and a generic "External transfer" payee. It's never written
 * to bank/import metadata (no importHash, no postedSeq) — distinguishing
 * it from real rows even outside `is_synthetic`.
 *
 * If the user later imports the real CSV for that external account, the
 * commit-batched route's reconciliation pass detects (account_id, date,
 * amount)-matching synthetics and promotes them in place — preserving
 * `id` and the source leg's `transfer_pair_id` pointer.
 *
 * Idempotency: matches `manualPair` — clears any pre-existing pair on
 * the source side and any stale suggestion rows.
 *
 * @returns the ids of the created synthetic txn + the (possibly
 *          newly-created) external account.
 */
export async function manualPairExternal(
  sourceTxnId: string,
  counterpartyName: string,
): Promise<{ syntheticId: string; externalAccountId: string }> {
  const trimmed = counterpartyName.trim();
  if (!trimmed) {
    throw new Error("counterpartyName must not be empty");
  }
  return await db.transaction(async (tx) => {
    const [source] = await tx
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
        currency: accounts.currency,
        transferPairId: transactions.transferPairId,
      })
      .from(transactions)
      .leftJoin(accounts, eq(accounts.id, transactions.accountId))
      .where(eq(transactions.id, sourceTxnId));
    if (!source) {
      throw new Error(`source transaction ${sourceTxnId} not found`);
    }

    // Find-or-create the external account. Case-insensitive lookup so
    // typing "hsbc savings" once and "HSBC Savings" later resolves to
    // one account, not two. Issue #64: skip ARCHIVED externals so a
    // fresh active one is created when the original was archived —
    // landing the synthetic in an archived account hides it from the
    // accounts list.
    const existingExternals = await tx
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.isExternal, true), eq(accounts.isArchived, false)));
    const lowered = trimmed.toLowerCase();
    let externalAccountId = existingExternals.find(
      (a) => a.name.toLowerCase() === lowered,
    )?.id;
    if (!externalAccountId) {
      const [created] = await tx
        .insert(accounts)
        .values({
          name: trimmed,
          type: "cash",
          currency: source.currency ?? "AUD",
          isExternal: true,
          isArchived: false,
          startingBalance: "0",
          currentBalance: "0",
        })
        .returning({ id: accounts.id });
      externalAccountId = created.id;
    }

    // Opposite-sign amount for the synthetic. Use string math via
    // parseFloat → negate → toFixed so we don't drop precision on
    // banker-style amounts already stored as text.
    const sourceAmt = parseFloat(source.amount);
    const syntheticAmount = (-sourceAmt).toFixed(2);

    // Clear any pre-existing pair on the source side (mirrors manualPair).
    if (source.transferPairId) {
      await tx
        .update(transactions)
        .set({ transferPairId: null, updatedAt: new Date() })
        .where(eq(transactions.id, source.transferPairId));
    }

    // Insert the synthetic stub.
    const [synthetic] = await tx
      .insert(transactions)
      .values({
        accountId: externalAccountId,
        date: source.date,
        amount: syntheticAmount,
        payee: "External transfer",
        description: null,
        categoryId: null,
        isSynthetic: true,
        transferPairId: sourceTxnId,
      })
      .returning({ id: transactions.id });

    // Link the source side back.
    await tx
      .update(transactions)
      .set({
        transferPairId: synthetic.id,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, sourceTxnId));

    // Drop any stale suggestion rows for the source side.
    await tx
      .delete(transferSuggestions)
      .where(
        or(
          eq(transferSuggestions.transactionId, sourceTxnId),
          eq(transferSuggestions.candidateId, sourceTxnId),
        ),
      );

    // Issue #65: recompute the External account's currentBalance so
    // it reflects the new synthetic. Every other transaction-insert
    // path follows insert with this same recompute; the synthetic-
    // mint paths used to skip it, which silently anchored every
    // downstream balance / dashboard tile / cashflow back-compute
    // at zero on External accounts with synthetic counterparts.
    await tx
      .update(accounts)
      .set({
        currentBalance: sql`(SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${externalAccountId}) + ${accounts.startingBalance}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, externalAccountId));

    return { syntheticId: synthetic.id, externalAccountId };
  });
}

/**
 * Break the pair on this transaction (and its counterpart), leaving both
 * rows un-linked. `is_transfer` stays as-is — the user marked it that way.
 *
 * If the counterpart was a synthetic stub (auto-minted by
 * `manualPairExternal`), it's deleted entirely — a free-floating
 * "External transfer" row in an untracked account is just noise.
 */
export async function manualUnpair(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ pairId: transactions.transferPairId })
      .from(transactions)
      .where(eq(transactions.id, id));
    if (!row?.pairId) return;
    const pairId = row.pairId;
    const [pair] = await tx
      .select({
        id: transactions.id,
        isSynthetic: transactions.isSynthetic,
      })
      .from(transactions)
      .where(eq(transactions.id, pairId));
    await tx
      .update(transactions)
      .set({ transferPairId: null, updatedAt: new Date() })
      .where(eq(transactions.id, id));
    if (pair?.isSynthetic) {
      // Synthetic stubs exist solely to back the pair on the source
      // side. Once the pair is gone the stub has no purpose — leaving
      // it would just clutter the external account with a spurious
      // "External transfer" row that the operator can't even click into
      // for context. Delete outright + recompute the External account's
      // currentBalance (issue #65 — same drift bug as the mint path).
      const [partner] = await tx
        .select({ accountId: transactions.accountId })
        .from(transactions)
        .where(eq(transactions.id, pairId));
      await tx.delete(transactions).where(eq(transactions.id, pairId));
      if (partner) {
        await tx
          .update(accounts)
          .set({
            currentBalance: sql`(SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${partner.accountId}) + ${accounts.startingBalance}`,
            updatedAt: new Date(),
          })
          .where(eq(accounts.id, partner.accountId));
      }
    } else {
      await tx
        .update(transactions)
        .set({ transferPairId: null, updatedAt: new Date() })
        .where(eq(transactions.id, pairId));
    }
  });
}
