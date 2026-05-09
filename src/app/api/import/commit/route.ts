import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { transactions, accounts, importLogs } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizePayee, batchLookupPayeeRules, batchSuggestCategoryByHistory, deriveMatchPayee, loadTokenFreq } from "@/lib/categorize";
import { pairTransfersInWindow, MAX_DATE_GAP_DAYS } from "@/lib/transfer-match";
import { newImportHash, oldImportHash } from "@/lib/import/hash";
import { learnAccountAlias } from "@/lib/import/resolve-account";

const rowSchema = z.object({
  date: z.string(),
  amount: z.string(),
  payee: z.string().optional().default(""),
  description: z.string().optional().default(""),
  rawId: z.string(),
  importHash: z.string(),
  categoryId: z.string().uuid().optional().nullable(),
  excluded: z.boolean().default(false),
  duplicate: z.boolean().default(false),
  // Bank-emitted ordering signals. Both optional — older imports have
  // neither, CSV/QIF imports have neither, OFX imports usually have both.
  postedAt: z.string().nullable().optional(),
  postedSeq: z.number().int().nullable().optional(),
  // Bank-supplied type/category — OFX TRNTYPE, QIF L, CSV Categories.
  // Stored verbatim on transactions.type for later weighting.
  type: z.string().nullable().optional(),
  // Post-transaction running balance from CSV "Balance" column.
  balance: z.string().nullable().optional(),
  // Bank-supplied account identifier (Westpac CSV "Bank Account" column,
  // QIF !Account name) — written to account_aliases on commit so future
  // imports auto-route this id to the user's chosen target account.
  bankAccountId: z.string().optional().nullable(),
});

const commitSchema = z.object({
  importLogId: z.string().uuid(),
  accountId: z.string().uuid(),
  rows: z.array(rowSchema),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { importLogId, accountId, rows } = commitSchema.parse(body);

  // Re-hash ALL rows server-side using the rawId-aware form. Look up DB rows
  // by both the new and old hash forms — pre-fix imports stored the old form
  // and we want to migrate them, not duplicate them.
  const allHashed = rows.map((r) => ({
    ...r,
    importHash: newImportHash(r),
  }));

  const newHashes = allHashed.map((r) => r.importHash);
  const oldHashes = allHashed.map((r) => oldImportHash(r));
  const lookupHashes = [...new Set([...newHashes, ...oldHashes])];
  const existing =
    lookupHashes.length > 0
      ? await db
          .select({
            id: transactions.id,
            importHash: transactions.importHash,
            categoryId: transactions.categoryId,
            postedAt: transactions.postedAt,
            postedSeq: transactions.postedSeq,
          })
          .from(transactions)
          .where(inArray(transactions.importHash, lookupHashes))
      : [];
  const existingByHash = new Map(existing.map((e) => [e.importHash, e]));

  // Resolve each parsed row to an existing DB row when possible. New-hash
  // matches are 1:1; old-hash matches can be many-to-one (the bug we're
  // fixing) so claim the first parsed row for the existing and treat the
  // rest as new. Track which rows matched via old-hash so we can migrate
  // their stored hash forward.
  const claimedOldHashes = new Set<string>();
  type Resolution = { existing: typeof existing[number]; matchedBy: "new" | "old" };
  const resolved = new Map<string, Resolution>();
  for (const r of allHashed) {
    const newEx = existingByHash.get(r.importHash);
    if (newEx) {
      resolved.set(r.importHash, { existing: newEx, matchedBy: "new" });
      continue;
    }
    const oldH = oldImportHash(r);
    if (claimedOldHashes.has(oldH)) continue;
    const oldEx = existingByHash.get(oldH);
    if (oldEx) {
      claimedOldHashes.add(oldH);
      resolved.set(r.importHash, { existing: oldEx, matchedBy: "old" });
    }
  }

  // Rows to insert: non-excluded, not resolved to an existing DB row, and
  // not already seen earlier in this batch.
  const seenInBatch = new Set<string>();
  const toInsert = allHashed.filter((r) => {
    if (r.excluded || resolved.has(r.importHash)) return false;
    if (seenInBatch.has(r.importHash)) return false;
    seenInBatch.add(r.importHash);
    return true;
  });

  // Selected duplicate rows — user has reviewed and wants categories applied
  const selectedDuplicates = allHashed.filter(
    (r) => !r.excluded && resolved.has(r.importHash)
  );

  // For new rows and selected duplicates without a user-supplied category, try rules/AI
  const needsAutoCategory = [
    ...toInsert.filter((r) => !r.categoryId && r.payee),
    ...selectedDuplicates.filter((r) => !r.categoryId && r.payee),
  ];

  const autoByHash = new Map<string, string>();
  if (needsAutoCategory.length > 0) {
    const normalizedMap = new Map(needsAutoCategory.map((r) => [r.importHash, normalizePayee(r.payee)]));
    // Per-row amount-aware lookup so two transactions with the same payee but
    // different amounts can resolve to different categories (e.g. multiple
    // insurance policies from one insurer).
    const lookupItems = needsAutoCategory
      .map((r) => ({
        key: r.importHash,
        normalizedPayee: normalizedMap.get(r.importHash) ?? "",
        amount: parseFloat(r.amount),
      }))
      .filter((i) => i.normalizedPayee);
    const localRules = await batchLookupPayeeRules(lookupItems);

    // Trigram suggester runs against everything still uncategorised; it
    // looks at the categorised history corpus and picks a dominant
    // category by similarity + amount-band proximity. No AI fallback —
    // categorisation runs entirely against local data.
    const stillUncategorised = lookupItems.filter((i) => !localRules.has(i.key));
    const trigramSuggestions = await batchSuggestCategoryByHistory(stillUncategorised);

    for (const r of needsAutoCategory) {
      const normalized = normalizedMap.get(r.importHash);
      if (!normalized) continue;
      const catId =
        localRules.get(r.importHash) ??
        trigramSuggestions.get(r.importHash)?.categoryId;
      if (catId) autoByHash.set(r.importHash, catId);
    }
  }

  // Wrap the insert + duplicate-update + balance recompute + import_logs
  // status flip in a single transaction. Without it, a failure mid-pipeline
  // (e.g. a numeric overflow in one row) could leave the import_log marked
  // "committed: N" while the matching transactions never landed, with the
  // user's surfaced row counts diverging from reality.
  const { categorised, backfilled } = await db.transaction(
    async (tx) => {
      if (toInsert.length > 0) {
        // Single freq-map fetch reused for every row so the per-tx-noise
        // strip sees the current token distribution.
        const tokenFreq = await loadTokenFreq();
        await tx.insert(transactions).values(
          toInsert.map((r) => {
            const normalized = r.payee ? normalizePayee(r.payee) : null;
            return {
              accountId,
              date: r.date,
              amount: r.amount,
              payee: r.payee,
              normalizedPayee: normalized,
              matchPayee: deriveMatchPayee(normalized, tokenFreq),
              description: r.description,
              categoryId: r.categoryId ?? autoByHash.get(r.importHash) ?? null,
              importHash: r.importHash,
              importLogId,
              postedAt: r.postedAt ? new Date(r.postedAt) : null,
              postedSeq: r.postedSeq ?? null,
              type: r.type ?? null,
              balance: r.balance ?? null,
            };
          }),
        );
      }

      // Apply updates to selected duplicates: category (if newly inferred)
      // and backfill of bank-ordering fields when this re-import has them
      // and the existing row doesn't. The existing categoryId is NEVER
      // overwritten with null — re-importing must not destroy work the
      // user has done.
      let categorisedCount = 0;
      let backfilledCount = 0;
      if (selectedDuplicates.length > 0) {
        const updates = selectedDuplicates
          .map((r) => {
            const res = resolved.get(r.importHash)!;
            const existing = res.existing;
            const newCatId = r.categoryId ?? autoByHash.get(r.importHash) ?? null;
            const willSetCategory = !!newCatId && newCatId !== existing.categoryId;
            const willSetPostedAt = !!r.postedAt && !existing.postedAt;
            const willSetPostedSeq = r.postedSeq != null && existing.postedSeq == null;
            const willMigrateHash =
              res.matchedBy === "old" && existing.importHash !== r.importHash;
            if (
              !willSetCategory &&
              !willSetPostedAt &&
              !willSetPostedSeq &&
              !willMigrateHash
            )
              return null;
            const patch: Partial<typeof transactions.$inferInsert> = {
              updatedAt: new Date(),
            };
            if (willSetCategory) patch.categoryId = newCatId;
            if (willSetPostedAt) patch.postedAt = new Date(r.postedAt!);
            if (willSetPostedSeq) patch.postedSeq = r.postedSeq!;
            if (willMigrateHash) patch.importHash = r.importHash;
            return {
              id: existing.id,
              patch,
              changedCategory: willSetCategory,
              changedOrder: willSetPostedAt || willSetPostedSeq,
            };
          })
          .filter(
            (
              u,
            ): u is {
              id: string;
              patch: Partial<typeof transactions.$inferInsert>;
              changedCategory: boolean;
              changedOrder: boolean;
            } => u !== null,
          );

        await Promise.all(
          updates.map((u) =>
            tx.update(transactions).set(u.patch).where(eq(transactions.id, u.id)),
          ),
        );
        categorisedCount = updates.filter((u) => u.changedCategory).length;
        backfilledCount = updates.filter((u) => u.changedOrder).length;
      }

      // Recompute account balance
      await tx
        .update(accounts)
        .set({
          currentBalance: sql`${accounts.startingBalance} + (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE account_id = ${accountId})`,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, accountId));

      // Rows skipped = anything the import didn't insert as a new
      // transaction: user-excluded, duplicates resolved to an existing DB
      // row, and duplicates within the same batch.
      const skipped = allHashed.length - toInsert.length;

      await tx
        .update(importLogs)
        .set({
          accountId,
          rowsImported: toInsert.length,
          rowsSkipped: skipped,
          status: "committed",
          committedAt: new Date(),
        })
        .where(eq(importLogs.id, importLogId));

      return {
        categorised: categorisedCount,
        backfilled: backfilledCount,
        rowsSkipped: skipped,
      };
    },
  );

  let pairsLinked = 0;
  let pairsSuggested = 0;
  if (toInsert.length > 0) {
    const dates = toInsert.map((r) => r.date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const minus = (iso: string, days: number) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    };
    const plus = (iso: string, days: number) => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    // Pairing is best-effort: rows are already committed at this point, so a
    // matcher failure should NOT make the import fail. The user can re-run
    // the repair endpoint to pick up missed pairs later.
    try {
      const result = await pairTransfersInWindow({
        since: minus(minDate, MAX_DATE_GAP_DAYS),
        until: plus(maxDate, MAX_DATE_GAP_DAYS),
      });
      pairsLinked = result.paired;
      pairsSuggested = result.suggested;
    } catch (err) {
      console.error("[import/commit] transfer-pair matcher failed:", err);
    }
  }

  // Learn account aliases from any row that came in with a bank-supplied
  // bankAccountId (CSV "Bank Account" column / QIF !Account name). Maps
  // each unique id seen → the user's chosen target accountId. Idempotent:
  // already-learned (kind, value) pairs no-op, and conflicting values
  // (same id pointing elsewhere) are not overwritten so a single mistake
  // doesn't lock in.
  const aliasesToLearn = new Set<string>();
  for (const r of rows) {
    if (r.excluded) continue;
    const id = r.bankAccountId?.trim();
    if (id) aliasesToLearn.add(id);
  }
  // Each upsert is independent — parallel round-trips beat sequential
  // awaits on a multi-account import.
  await Promise.all(
    Array.from(aliasesToLearn).map((id) =>
      learnAccountAlias("bank-account", id, accountId),
    ),
  );

  return NextResponse.json({
    imported: toInsert.length,
    categorised,
    backfilled,
    pairsLinked,
    pairsSuggested,
    aliasesLearned: aliasesToLearn.size,
  });
}
