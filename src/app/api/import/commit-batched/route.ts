import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { accounts, importLogs, transactions } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { oldImportHash } from "@/lib/import/hash";
import {
  normalizePayee,
  deriveMatchPayee,
  loadTokenFreq,
  invalidateTokenFreqCache,
} from "@/lib/categorize";
import { learnAccountAlias } from "@/lib/import/resolve-account";
import { pairTransfersInWindow } from "@/lib/transfer-match";
import { diffDaysISO } from "@/lib/utils";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
import { chunkedQuery, chunkedExec } from "@/lib/api/chunked";

const rowSchema = z.object({
  /** Where this row should land. Required — rows without a resolved
   * account are skipped by the caller. */
  accountId: z.string().uuid(),
  date: z.string(),
  amount: z.string(),
  payee: z.string().optional().default(""),
  description: z.string().optional().default(""),
  importHash: z.string(),
  rawId: z.string(),
  categoryId: z.string().uuid().nullable().optional(),
  postedAt: z.string().nullable().optional(),
  postedSeq: z.number().int().nullable().optional(),
  type: z.string().nullable().optional(),
  balance: z.string().nullable().optional(),
  /** Optional bank-account-id; learned as an alias on first sighting so
   * subsequent imports auto-route. */
  bankAccountId: z.string().nullable().optional(),
});

const bodySchema = z.object({
  filename: z.string().min(1),
  format: z.string().min(1),
  rows: z.array(rowSchema).min(1),
});

/**
 * Multi-account commit: takes a flat list of pre-resolved rows (each
 * with its own `accountId`), groups by account, creates one
 * `import_logs` entry per account, and inserts transactions skipping
 * `importHash` duplicates. The only commit endpoint; the import view
 * POSTs here from its "Commit to DB" action after the categorise pass.
 *
 * Doesn't re-run categorisation (the categorise route already produced
 * `categoryId`s). DOES run transfer-pair matching after insert — see
 * the `pairTransfersInWindow` call at the bottom; idempotent so an
 * import with no transfer rows just no-ops. Aliases learned from
 * each row's `bankAccountId` → resolved `accountId` so future
 * imports auto-route.
 */
export const POST = withAuth(async (request) => {
  try {
    return await runCommit(request);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Commit failed";
    console.error("[commit-batched]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

async function runCommit(request: Request) {
  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { filename, format, rows } = parsed.data;

  // Guard: every accountId must reference an existing accounts row.
  const requestedAccountIds = Array.from(new Set(rows.map((r) => r.accountId)));
  const validAccounts = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.id, requestedAccountIds));
  const validIds = new Set(validAccounts.map((a) => a.id));
  const unknownAccountIds = requestedAccountIds.filter((id) => !validIds.has(id));
  if (unknownAccountIds.length > 0) {
    return NextResponse.json(
      { error: `Unknown account IDs: ${unknownAccountIds.join(", ")}` },
      { status: 400 },
    );
  }

  // Dedup against existing transactions in three layers:
  //   1. Exact importHash match — already in DB, fill nulls only.
  //   2. Legacy hash match (date|amount|payee, no rawId) — backfill +
  //      migrate hash forward to the rawId-aware form.
  //   3. Heuristic match (same date+amount, similar normalized_payee)
  //      — covers cross-format imports (e.g. existing OFX, new CSV
  //      where every hash differs). Backfill + migrate hash forward
  //      so subsequent commits of the same file resolve via layer 1.
  const newHashes = rows.map((r) => r.importHash);
  const oldHashes = rows.map((r) => oldImportHash(r));
  const lookupHashes = [...new Set([...newHashes, ...oldHashes])];
  // SQLite's SQLITE_MAX_VARIABLE_NUMBER cap is 32766 in this build.
  // A large single-account CSV import generates up to 2 hashes per
  // input row before dedup, so a 20k-row file would push 40k params
  // through one inArray and 500 the request with "too many SQL
  // variables". chunkedQuery splits the lookup into 5000-id slices
  // (single-column inArray = 1 param per id) — well under the cap.
  const existing = await chunkedQuery(lookupHashes, 5000, (slice) =>
    db
      .select({
        id: transactions.id,
        importHash: transactions.importHash,
        accountId: transactions.accountId,
        categoryId: transactions.categoryId,
        type: transactions.type,
        balance: transactions.balance,
        postedAt: transactions.postedAt,
        postedSeq: transactions.postedSeq,
      })
      .from(transactions)
      .where(inArray(transactions.importHash, slice)),
  );
  const existingByHash = new Map(existing.map((e) => [e.importHash, e]));
  const claimedOldHashes = new Set<string>();

  // Pre-fetch heuristic candidates for the rows that didn't hash-match.
  // One bulk query, grouped client-side; avoids per-row round-trips.
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const heuristicCandidates = rows.filter((r) => ISO_DATE.test(r.date));
  type HeurExisting = {
    id: string;
    importHash: string;
    accountId: string;
    date: string;
    amount: string;
    normalizedPayee: string | null;
    categoryId: string | null;
    type: string | null;
    balance: string | null;
    postedSeq: number | null;
  };
  const heuristicByKey = new Map<string, HeurExisting[]>();
  if (heuristicCandidates.length > 0) {
    // Pull existing rows that match any candidate's (accountId, date), then
    // JS-filter by amount equality on canonical 2-decimal form. SQLite
    // stores amount as text so we canonicalise both sides via
    // parseFloat(...).toFixed(2) for cross-format consistency.
    const wantedAccountIds = Array.from(
      new Set(heuristicCandidates.map((r) => r.accountId)),
    );
    const wantedDates = Array.from(new Set(heuristicCandidates.map((r) => r.date)));
    const wantedKeys = new Set(
      heuristicCandidates.map(
        (r) => `${r.accountId}|${r.date}|${parseFloat(r.amount).toFixed(2)}`,
      ),
    );
    const dbRows = await db
      .select({
        id: transactions.id,
        importHash: transactions.importHash,
        accountId: transactions.accountId,
        date: transactions.date,
        amount: transactions.amount,
        normalizedPayee: transactions.normalizedPayee,
        categoryId: transactions.categoryId,
        type: transactions.type,
        balance: transactions.balance,
        postedSeq: transactions.postedSeq,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.accountId, wantedAccountIds),
          inArray(transactions.date, wantedDates),
        ),
      );
    for (const h of dbRows) {
      const canonicalAmount = parseFloat(h.amount).toFixed(2);
      const k = `${h.accountId}|${h.date}|${canonicalAmount}`;
      if (!wantedKeys.has(k)) continue;
      let arr = heuristicByKey.get(k);
      if (!arr) {
        arr = [];
        heuristicByKey.set(k, arr);
      }
      arr.push({
        id: h.id,
        importHash: h.importHash ?? "",
        accountId: h.accountId,
        date: h.date,
        amount: canonicalAmount,
        normalizedPayee: h.normalizedPayee,
        categoryId: h.categoryId,
        type: h.type,
        balance: h.balance,
        postedSeq: h.postedSeq,
      });
    }
  }
  const claimedHeuristicIds = new Set<string>();
  function payeeSimilarity(a: string, b: string): number {
    const wa = new Set(a.split(/\s+/).filter(Boolean));
    const wb = new Set(b.split(/\s+/).filter(Boolean));
    if (wa.size === 0 && wb.size === 0) return 1;
    if (wa.size === 0 || wb.size === 0) return 0;
    let inter = 0;
    for (const w of wa) if (wb.has(w)) inter += 1;
    return inter / (wa.size + wb.size - inter);
  }
  const PAYEE_SIM_THRESHOLD = 0.5;

  // Trust the importHash the categorise route computed — re-hashing
  // here against a fresh rawId would diverge from what the DB stored
  // on the first import and break dedupe. Categorise already routed
  // each row through the same format-aware parser the user sees in
  // the review panel; the hash that came back is authoritative.
  const tokenFreq = await loadTokenFreq();
  const insertsByAccount = new Map<string, typeof rows>();
  type DupeMatch = (typeof existing)[number] | HeurExisting;
  type DupeUpdate = {
    row: (typeof rows)[number];
    existingRow: DupeMatch;
    matchedBy: "exact" | "legacy" | "heuristic";
  };
  const dupeUpdates: DupeUpdate[] = [];
  for (const r of rows) {
    const direct = existingByHash.get(r.importHash);
    if (direct) {
      dupeUpdates.push({ row: r, existingRow: direct, matchedBy: "exact" });
      continue;
    }
    const oh = oldImportHash(r);
    if (!claimedOldHashes.has(oh)) {
      const legacy = existingByHash.get(oh);
      if (legacy) {
        claimedOldHashes.add(oh);
        dupeUpdates.push({ row: r, existingRow: legacy, matchedBy: "legacy" });
        continue;
      }
    }
    // Heuristic: among existing rows with same (account, date, amount),
    // pick the one whose normalized_payee is most similar. Threshold
    // gates so unrelated same-amount rows aren't false-matched.
    const candidates = heuristicByKey.get(`${r.accountId}|${r.date}|${r.amount}`);
    if (candidates && candidates.length > 0) {
      const newPayee = normalizePayee(r.payee ?? "");
      let best: HeurExisting | null = null;
      let bestSim = 0;
      for (const c of candidates) {
        if (claimedHeuristicIds.has(c.id)) continue;
        const s = payeeSimilarity(newPayee, c.normalizedPayee ?? "");
        if (s > bestSim) {
          bestSim = s;
          best = c;
        }
      }
      if (best && bestSim >= PAYEE_SIM_THRESHOLD) {
        claimedHeuristicIds.add(best.id);
        dupeUpdates.push({ row: r, existingRow: best, matchedBy: "heuristic" });
        continue;
      }
    }
    let arr = insertsByAccount.get(r.accountId);
    if (!arr) {
      arr = [];
      insertsByAccount.set(r.accountId, arr);
    }
    arr.push(r);
  }

  // Pull the current max(posted_seq) per touched account so we can
  // offset the parser-assigned 0..N-1 values forward. The parser
  // numbers rows by file position only, so two CSV imports for the
  // same account both produce postedSeq=0 on the first row — and
  // when those rows share a date, the running-balance tuple compare
  // `(date, posted_seq, COALESCE(posted_at, created_at), id)` falls
  // through to created_at (= insert timestamp, NOT bank time),
  // which reorders intra-day rows and breaks the running balance.
  // Offsetting by per-account max keeps relative intra-file order
  // (constant offset) while making postedSeq unique per account, so
  // the tiebreaker always resolves before falling through. The map
  // covers every account in the request (inserts AND dupe-backfill
  // updates) since both paths offset against the same base.
  const touchedAccountIds = Array.from(
    new Set<string>([
      ...insertsByAccount.keys(),
      ...dupeUpdates.map((u) => u.existingRow.accountId),
    ]),
  );
  // Issue #76: was N sequential MAX queries per touched account.
  // One GROUP BY does the same in a single round-trip; missing
  // accounts (no prior txns) default to -1 below.
  const maxByAccount = new Map<string, number>();
  if (touchedAccountIds.length > 0) {
    const maxRows = await db
      .select({
        accountId: transactions.accountId,
        m: sql<number>`COALESCE(MAX(${transactions.postedSeq}), -1)`,
      })
      .from(transactions)
      .where(inArray(transactions.accountId, touchedAccountIds))
      .groupBy(transactions.accountId);
    for (const r of maxRows) {
      maxByAccount.set(r.accountId, Number(r.m ?? -1));
    }
    for (const id of touchedAccountIds) {
      if (!maxByAccount.has(id)) maxByAccount.set(id, -1);
    }
  }

  const importLogIds: string[] = [];
  let imported = 0;
  for (const [accountId, group] of insertsByAccount) {
    const [log] = await db
      .insert(importLogs)
      .values({
        filename,
        format,
        accountId,
        rowsParsed: group.length,
        rowsImported: group.length,
        status: "committed",
        committedAt: new Date(),
      })
      .returning({ id: importLogs.id });
    importLogIds.push(log.id);

    if (group.length === 0) continue;
    const offset = (maxByAccount.get(accountId) ?? -1) + 1;

    // ── Synthetic reconciliation ──────────────────────────────────────
    // When the user previously linked a transfer to an untracked
    // counterparty via "Link as transfer (external)", we minted a
    // synthetic stub in this account (see transfer-match.ts:
    // manualPairExternal). If the user is now importing real CSV
    // rows for this account, those incoming rows may correspond to
    // those stubs — same amount, ±3 days of the stub's date.
    // Promoting in place preserves the synthetic's id and its
    // `transfer_pair_id` pointer, so the source-leg's pair stays
    // valid. Greedy 1:1 assignment; exact amount match (cents-level
    // mismatches like fees fall through to a fresh insert and the
    // user can re-link manually).
    const syntheticCandidates = await db
      .select({
        id: transactions.id,
        date: transactions.date,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.accountId, accountId),
          eq(transactions.isSynthetic, true),
        ),
      );
    const claimedSynthetics = new Set<string>();
    type Row = (typeof group)[number];
    const promotions: { syntheticId: string; row: Row }[] = [];
    const remainingToInsert: Row[] = [];
    for (const r of group) {
      const rAmtCanonical = parseFloat(r.amount).toFixed(2);
      let best: { id: string; date: string } | null = null;
      let bestDays = Infinity;
      for (const s of syntheticCandidates) {
        if (claimedSynthetics.has(s.id)) continue;
        if (parseFloat(s.amount).toFixed(2) !== rAmtCanonical) continue;
        const days = Math.abs(diffDaysISO(r.date, s.date));
        if (days > 3) continue;
        if (days < bestDays) {
          bestDays = days;
          best = { id: s.id, date: s.date };
        }
      }
      if (best) {
        claimedSynthetics.add(best.id);
        promotions.push({ syntheticId: best.id, row: r });
      } else {
        remainingToInsert.push(r);
      }
    }

    // Promote each matched synthetic in place. Keep `transferPairId`
    // and the row `id` untouched; overwrite payee/description/import
    // metadata with the real CSV's values. Date is set to the bank's
    // posted date (the synthetic's date was a placeholder from the
    // source leg).
    let promotedCount = 0;
    for (const { syntheticId, row: r } of promotions) {
      const normalized = r.payee ? normalizePayee(r.payee) : null;
      await db
        .update(transactions)
        .set({
          date: r.date,
          payee: r.payee,
          normalizedPayee: normalized,
          matchPayee: deriveMatchPayee(normalized, tokenFreq),
          description: r.description,
          categoryId: r.categoryId ?? null,
          importHash: r.importHash,
          importLogId: log.id,
          postedAt: r.postedAt ? new Date(r.postedAt) : null,
          postedSeq: r.postedSeq != null ? r.postedSeq + offset : null,
          type: r.type ?? null,
          balance: r.balance ?? null,
          isSynthetic: false,
          updatedAt: new Date(),
        })
        .where(eq(transactions.id, syntheticId));
      promotedCount += 1;
    }

    if (remainingToInsert.length > 0) {
      // ~15 fields per row × N rows = total bound parameters.
      // SQLITE_MAX_VARIABLE_NUMBER caps the statement at 32766 in
      // this build; 1500 rows × 15 fields = 22500 leaves headroom.
      // Without chunking a single-account >2200-row CSV 500's the
      // request with "too many SQL variables".
      await chunkedExec(remainingToInsert, 1500, (slice) =>
        db.insert(transactions).values(
          slice.map((r) => {
            const normalized = r.payee ? normalizePayee(r.payee) : null;
            return {
              accountId,
              date: r.date,
              amount: r.amount,
              payee: r.payee,
              normalizedPayee: normalized,
              matchPayee: deriveMatchPayee(normalized, tokenFreq),
              description: r.description,
              categoryId: r.categoryId ?? null,
              importHash: r.importHash,
              importLogId: log.id,
              postedAt: r.postedAt ? new Date(r.postedAt) : null,
              // Offset the parser's per-file 0..N-1 by the account's
              // current max+1 so postedSeq stays unique across imports.
              // Relative order within the file is preserved (constant
              // offset), so intra-day bank order still wins.
              postedSeq: r.postedSeq != null ? r.postedSeq + offset : null,
              type: r.type ?? null,
              balance: r.balance ?? null,
            };
          }),
        ),
      );
    }
    imported += group.length;
    void promotedCount;

    // Refresh accounts.currentBalance so the dashboard widget +
    // sidebar pick up the new total without waiting for a SWR
    // refetch round-trip.
    await db
      .update(accounts)
      .set({
        currentBalance: sql`${accounts.startingBalance} + (SELECT COALESCE(SUM(amount), 0) FROM ${transactions} WHERE ${transactions.accountId} = ${accountId})`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
  }

  // Duplicate-row backfill: migrate legacy hashes forward to the
  // rawId-aware form and fill in missing type/balance/categoryId fields
  // from the new richer file. Categories are only filled when missing —
  // never overwritten so a user-set category isn't clobbered by a
  // re-import.
  let migratedHashes = 0;
  let backfilledType = 0;
  let backfilledBalance = 0;
  let backfilledCategory = 0;
  let backfilledPostedSeq = 0;
  for (const u of dupeUpdates) {
    const patch: Partial<typeof transactions.$inferInsert> = {};
    // Both legacy and heuristic matches need the stored hash migrated to
    // the new file's rawId-aware form so subsequent commits resolve via
    // the strict (exact) path. Exact matches already have the right hash.
    if (
      (u.matchedBy === "legacy" || u.matchedBy === "heuristic") &&
      u.existingRow.importHash !== u.row.importHash
    ) {
      patch.importHash = u.row.importHash;
      migratedHashes += 1;
    }
    if (u.row.type && !u.existingRow.type) {
      patch.type = u.row.type;
      backfilledType += 1;
    }
    if (u.row.balance && !u.existingRow.balance) {
      patch.balance = u.row.balance;
      backfilledBalance += 1;
    }
    if (u.row.categoryId && !u.existingRow.categoryId) {
      patch.categoryId = u.row.categoryId;
      backfilledCategory += 1;
    }
    if (u.row.postedSeq != null && u.existingRow.postedSeq == null) {
      // Apply the same per-account offset as the inserts above so
      // backfilled values don't collide with the (offset) insert
      // space for the same import. existingRow.accountId is the
      // account the row already lives in; same offset map.
      const offset = (maxByAccount.get(u.existingRow.accountId) ?? -1) + 1;
      patch.postedSeq = u.row.postedSeq + offset;
      backfilledPostedSeq += 1;
    }
    if (Object.keys(patch).length === 0) continue;
    patch.updatedAt = new Date();
    await db
      .update(transactions)
      .set(patch)
      .where(eq(transactions.id, u.existingRow.id));
  }

  // Per-date repair pass. Walks the (now post-insert) chain in
  // canonical tuple order and, for any date where the chain
  // predicts a balance different from the stored bank value on
  // ANY row, re-derives the bank's true intra-day order from
  // stored balances via reconciliation (`prev + amount = next`
  // resolves a unique order when stored balances are all set).
  // The corrected order takes the SAME set of `posted_seq` values
  // the affected rows already had, just permuted, so global
  // per-account uniqueness is preserved without minting new
  // values.
  //
  // This does NOT require the new file to carry a Balance column
  // — only the DB's own stored balances. Surfaced separately
  // from the `backfilledPostedSeq` (null→value) counter as
  // `correctedPostedSeq` so the operator can see whether their
  // re-import nudged the chain back into shape.
  let correctedPostedSeq = 0;
  {
    const touchedAccountIds = Array.from(
      new Set<string>([
        ...insertsByAccount.keys(),
        ...dupeUpdates.map((u) => u.existingRow.accountId),
      ]),
    );
    if (touchedAccountIds.length > 0) {
      const dbRows = await db
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          date: transactions.date,
          amount: transactions.amount,
          balance: transactions.balance,
          postedSeq: transactions.postedSeq,
        })
        .from(transactions)
        .where(inArray(transactions.accountId, touchedAccountIds))
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
        .where(inArray(accounts.id, touchedAccountIds));
      const startingByAccountId = new Map(
        accountRows.map((a) => [a.id, parseFloat(a.startingBalance)]),
      );
      // Group rows by (accountId, date) preserving sort order
      // within each group so each "slot" of posted_seq is kept
      // available for the rearranged assignments.
      const groupedRows = new Map<
        string,
        Map<string, typeof dbRows>
      >();
      for (const t of dbRows) {
        let byAccount = groupedRows.get(t.accountId);
        if (!byAccount) {
          byAccount = new Map();
          groupedRows.set(t.accountId, byAccount);
        }
        const arr = byAccount.get(t.date) ?? [];
        arr.push(t);
        byAccount.set(t.date, arr);
      }
      for (const accountId of touchedAccountIds) {
        const byDate = groupedRows.get(accountId);
        if (!byDate) continue;
        const sortedDates = Array.from(byDate.keys()).sort();
        let cumulative = startingByAccountId.get(accountId) ?? 0;
        for (const date of sortedDates) {
          const dayRows = byDate.get(date)!;
          const dayStart = cumulative;
          // End-of-day cumulative is just sum-of-amounts regardless
          // of intra-day order, so advance unconditionally.
          for (const t of dayRows) {
            cumulative += parseFloat(t.amount);
          }
          // Detect mismatch in current intra-day order.
          let chainPos = dayStart;
          let needsRepair = false;
          for (const t of dayRows) {
            chainPos += parseFloat(t.amount);
            if (t.balance == null) continue;
            const stored = parseFloat(t.balance);
            if (!Number.isFinite(stored)) continue;
            if (Math.abs(stored - chainPos) >= 0.01) {
              needsRepair = true;
              break;
            }
          }
          if (!needsRepair) continue;
          // Reconciliation pass: greedy `prev + amount = next`.
          // Requires every row on the date to have a stored
          // balance; otherwise we can't resolve the order
          // unambiguously and we skip.
          if (!dayRows.every((t) => t.balance != null)) continue;
          const remaining = dayRows.map((t) => ({
            id: t.id,
            amount: parseFloat(t.amount),
            balance: parseFloat(t.balance ?? "NaN"),
          }));
          if (remaining.some((r) => !Number.isFinite(r.balance))) continue;
          const orderedIds: string[] = [];
          let prev = dayStart;
          let ambiguous = false;
          while (remaining.length > 0) {
            const matches = remaining.filter(
              (r) => Math.abs(r.balance - prev - r.amount) < 0.01,
            );
            if (matches.length !== 1) {
              ambiguous = true;
              break;
            }
            const next = matches[0];
            orderedIds.push(next.id);
            prev = next.balance;
            const idx = remaining.indexOf(next);
            remaining.splice(idx, 1);
          }
          if (ambiguous || orderedIds.length !== dayRows.length) continue;
          // Existing `posted_seq` values on this date, in current
          // order. The reconciliation tells us which row goes in
          // which slot; we just permute the existing values so
          // no new posted_seq is minted and the global per-account
          // uniqueness invariant holds.
          const slotValues = dayRows
            .map((t) => t.postedSeq)
            .filter((s): s is number => s != null);
          if (slotValues.length !== dayRows.length) continue;
          // Apply the permutation: orderedIds[i] gets slotValues[i].
          for (let i = 0; i < orderedIds.length; i++) {
            const id = orderedIds[i];
            const newSeq = slotValues[i];
            const current = dayRows.find((t) => t.id === id);
            if (!current) continue;
            if (current.postedSeq === newSeq) continue;
            await db
              .update(transactions)
              .set({ postedSeq: newSeq, updatedAt: new Date() })
              .where(eq(transactions.id, id));
            correctedPostedSeq += 1;
          }
        }
      }
    }
  }

  // Auto-learn account_aliases from any non-empty bankAccountId we saw,
  // mapped to whichever accountId those rows ended up routed to. Same
  // idempotency rules as the regular commit.
  //
  // `aliasesLearned` (returned below) is the count of aliases that
  // ACTUALLY got inserted on this call — not the input-row count.
  // `learnAccountAlias` returns true only on a fresh insert; a
  // re-commit of the same bankAccountId reports 0, matching the
  // user's intuition.
  const aliasesToLearn = new Map<string, string>();
  for (const r of rows) {
    const id = r.bankAccountId?.trim();
    if (id) aliasesToLearn.set(id, r.accountId);
  }
  let aliasesLearned = 0;
  for (const [aliasValue, accountId] of aliasesToLearn) {
    if (await learnAccountAlias("bank-account", aliasValue, accountId)) {
      aliasesLearned += 1;
    }
  }

  // Auto-run transfer-pair matching against every unpaired row.
  // The historical comment "doesn't run transfer-pair matching" was
  // a footgun — a user importing one bank's CSV would never see the
  // matcher until they manually hit /api/transfers/repair (and no UI
  // exposed that endpoint). The matcher is idempotent — only touches
  // `transfer_pair_id IS NULL` rows — and amortises across import
  // size, so running it on every commit is safe + makes auto-pairing
  // the expected default behaviour. A failure here is non-fatal: the
  // commit already succeeded; we surface the error in the response
  // and the user can re-run via the manual button on /transactions.
  let pairResult: { paired: number; suggested: number } | null = null;
  let pairError: string | null = null;
  try {
    pairResult = await pairTransfersInWindow({});
  } catch (e) {
    pairError = e instanceof Error ? e.message : String(e);
    console.error("[commit-batched] transfer-match sweep failed:", e);
  }

  // Issue #96: the import just changed (potentially many) normalised
  // payees in the corpus. Drop the token-freq cache so the next
  // `loadTokenFreq()` rebuilds against the new state.
  invalidateTokenFreqCache();

  return NextResponse.json({
    imported,
    skippedDuplicate: dupeUpdates.length,
    migratedHashes,
    backfilledType,
    backfilledBalance,
    backfilledCategory,
    backfilledPostedSeq,
    correctedPostedSeq,
    importLogIds,
    accountsTouched: insertsByAccount.size,
    aliasesLearned,
    transfersPaired: pairResult?.paired ?? 0,
    transfersSuggested: pairResult?.suggested ?? 0,
    transferMatchError: pairError,
  });
}
