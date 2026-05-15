import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts, importLogs, transactions } from "@/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { oldImportHash } from "@/lib/import/hash";
import {
  normalizePayee,
  deriveMatchPayee,
  loadTokenFreq,
} from "@/lib/categorize";
import { learnAccountAlias } from "@/lib/import/resolve-account";

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
 * Multi-account commit: takes a flat list of pre-resolved rows (each with
 * its own `accountId`), groups by account, creates one `import_logs`
 * entry per account, and inserts transactions skipping importHash
 * duplicates. Used by the import view's "Commit to DB" action so the
 * user can commit a multi-account file in one go without going through
 * the wizard.
 *
 * Doesn't re-run categorisation (the categorise route has already produced
 * categoryIds). Doesn't run transfer-pair matching here — caller can run
 * that separately. Aliases learned from each row's bankAccountId →
 * resolved accountId so future imports route automatically.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return await runCommit(request);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Commit failed";
    console.error("[commit-batched]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runCommit(request: Request) {
  const body = await request.json();
  const { filename, format, rows } = bodySchema.parse(body);

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
  const existing = lookupHashes.length
    ? await db
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
        .where(inArray(transactions.importHash, lookupHashes))
    : [];
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

  // Trust the importHash computed by the tester upstream — re-hashing
  // here with a tester-fabricated rawId would produce a different hash
  // and break dedup against existing DB rows. The tester's hash already
  // came from the format-aware parser, which is what real imports use.
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
  const maxByAccount = new Map<string, number>();
  for (const accountId of touchedAccountIds) {
    const [maxRow] = await db
      .select({
        m: sql<number>`COALESCE(MAX(${transactions.postedSeq}), -1)`,
      })
      .from(transactions)
      .where(eq(transactions.accountId, accountId));
    maxByAccount.set(accountId, Number(maxRow?.m ?? -1));
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
    await db.insert(transactions).values(
      group.map((r) => {
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
    );
    imported += group.length;

    // Refresh accounts.currentBalance the same way the wizard's commit
    // route does so the dashboard tile stays in sync.
    await db
      .update(accounts)
      .set({
        currentBalance: sql`${accounts.startingBalance} + (SELECT COALESCE(SUM(amount), 0) FROM ${transactions} WHERE ${transactions.accountId} = ${accountId})`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
  }

  // Pre-insert DB chain check, per touched account. Walks the
  // existing rows in `(date, posted_seq, posted_at|created_at, id)`
  // order — same tuple the running-balance view uses — and predicts
  // each row's balance as (starting + cumulative amounts). For any
  // existing row whose stored bank balance disagrees with the
  // chain-predicted value, the dupe-update loop is allowed to
  // overwrite the existing posted_seq with the file's parser-
  // assigned value (offset by per-account max so it stays unique).
  // This is how prior posted_seq mistakes get corrected when the
  // user re-imports a file the bank emits with balance data.
  const expectedBalanceByDbRowId = new Map<string, number>();
  {
    const accountIdsForChain = Array.from(
      new Set(dupeUpdates.map((u) => u.existingRow.accountId)),
    );
    if (accountIdsForChain.length > 0) {
      const dbRows = await db
        .select({
          id: transactions.id,
          accountId: transactions.accountId,
          amount: transactions.amount,
          balance: transactions.balance,
        })
        .from(transactions)
        .where(inArray(transactions.accountId, accountIdsForChain))
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
        .where(inArray(accounts.id, accountIdsForChain));
      const startingByAccountId = new Map(
        accountRows.map((a) => [a.id, parseFloat(a.startingBalance)]),
      );
      const running = new Map<string, number>();
      for (const id of accountIdsForChain) {
        running.set(id, startingByAccountId.get(id) ?? 0);
      }
      for (const t of dbRows) {
        const prev = running.get(t.accountId) ?? 0;
        const next = prev + parseFloat(t.amount);
        expectedBalanceByDbRowId.set(t.id, +next.toFixed(2));
        running.set(t.accountId, next);
      }
    }
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
  let correctedPostedSeq = 0;
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
    } else if (
      u.row.postedSeq != null &&
      u.row.balance != null &&
      u.existingRow.balance != null &&
      u.existingRow.postedSeq != null
    ) {
      // Correction path: the existing row already had a posted_seq,
      // but the DB chain disagrees with the bank-claimed balance on
      // it. Trust the file's balance-aware posted_seq (offset to
      // stay unique per account) and overwrite. The file's own
      // chain consistency was already validated by the categorise
      // endpoint; if the operator committed it then they accepted
      // the diff.
      const expected = expectedBalanceByDbRowId.get(u.existingRow.id);
      const stored = parseFloat(u.existingRow.balance);
      const dbChainBroken =
        expected != null &&
        Number.isFinite(stored) &&
        Math.abs(stored - expected) >= 0.01;
      if (dbChainBroken) {
        const offset =
          (maxByAccount.get(u.existingRow.accountId) ?? -1) + 1;
        patch.postedSeq = u.row.postedSeq + offset;
        correctedPostedSeq += 1;
      }
    }
    if (Object.keys(patch).length === 0) continue;
    patch.updatedAt = new Date();
    await db
      .update(transactions)
      .set(patch)
      .where(eq(transactions.id, u.existingRow.id));
  }

  // Auto-learn account_aliases from any non-empty bankAccountId we saw,
  // mapped to whichever accountId those rows ended up routed to. Same
  // idempotency rules as the regular commit.
  const aliasesToLearn = new Map<string, string>();
  for (const r of rows) {
    const id = r.bankAccountId?.trim();
    if (id) aliasesToLearn.set(id, r.accountId);
  }
  for (const [aliasValue, accountId] of aliasesToLearn) {
    await learnAccountAlias("bank-account", aliasValue, accountId);
  }

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
    aliasesLearned: aliasesToLearn.size,
  });
}
