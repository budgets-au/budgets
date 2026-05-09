import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { importLogs, transactions } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { detectFormat } from "@/lib/import/detect-format";
import { parseCSV } from "@/lib/import/parse-csv";
import { parseOFX } from "@/lib/import/parse-ofx";
import { parseQIF } from "@/lib/import/parse-qif";
import { detectAccount } from "@/lib/import/detect-account";
import {
  normalizePayee,
  batchLookupPayeeRules,
  batchSuggestCategoryByHistory,
} from "@/lib/categorize";
import { oldImportHash } from "@/lib/import/hash";

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const content = await file.text();
  const format = detectFormat(file.name, content);

  let rows: ReturnType<typeof parseCSV> = [];
  let institution: string | undefined;
  let accountNumber: string | undefined;
  let detectedAccountId: string | null = null;

  try {
    if (format === "csv") {
      rows = parseCSV(content);
    } else if (format === "ofx" || format === "qfx") {
      const { rows: r, meta } = parseOFX(content);
      rows = r;
      institution = meta.institution;
      accountNumber = meta.accountId;
      detectedAccountId = await detectAccount(institution, accountNumber);
    } else if (format === "qif") {
      rows = parseQIF(content);
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Parse error: ${(e as Error).message}` },
      { status: 422 }
    );
  }

  // Check for duplicates against both the new and old import-hash forms.
  // The old form (sha256(date|amount|payee)) collided on same-day, same-
  // amount, same-payee txns and silently dropped duplicates; the new form
  // adds rawId. Pre-fix rows in DB still carry the old hash, so we look up
  // by both and fall back to a one-to-one claim when only the old hash
  // matches.
  const newHashes = rows.map((r) => r.importHash).filter(Boolean);
  const oldHashes = rows.map((r) => oldImportHash(r));
  const lookupHashes = [...new Set([...newHashes, ...oldHashes])];
  const existing = lookupHashes.length
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
  const claimedOldHashes = new Set<string>();

  const rowsWithDupeFlag = rows.map((r) => {
    let ex = existingByHash.get(r.importHash);
    if (!ex) {
      const oldH = oldImportHash(r);
      if (!claimedOldHashes.has(oldH)) {
        const oldEx = existingByHash.get(oldH);
        if (oldEx) {
          claimedOldHashes.add(oldH);
          ex = oldEx;
        }
      }
    }
    const willBackfill =
      !!ex &&
      ((r.postedAt && !ex.postedAt) || (r.postedSeq != null && ex.postedSeq == null));
    return {
      ...r,
      duplicate: !!ex,
      existingCategoryId: ex?.categoryId ?? null,
      willBackfill,
    };
  });

  // Build the full set of rows needing auto-categorisation:
  // - new rows with no category
  // - duplicate rows that are uncategorised in the DB
  const needsCategory = rowsWithDupeFlag.filter(
    (r) => r.payee && (!r.duplicate || !r.existingCategoryId)
  );

  const categoryByHash = new Map<string, string>();

  if (needsCategory.length > 0) {
    const normalizedMap = new Map(needsCategory.map((r) => [r.importHash, normalizePayee(r.payee)]));
    // Build per-row items for the amount-aware lookup.
    const lookupItems = needsCategory
      .map((r) => ({
        key: r.importHash,
        normalizedPayee: normalizedMap.get(r.importHash) ?? "",
        amount: parseFloat(r.amount),
      }))
      .filter((i) => i.normalizedPayee);
    const localRules = await batchLookupPayeeRules(lookupItems);

    // Trigram suggester for everything still uncategorised. The categorised
    // history corpus is the training set — no AI / external service is
    // involved, so we don't have to scrub payees for third-party safety.
    const stillUncategorised = lookupItems.filter((i) => !localRules.has(i.key));
    const trigramSuggestions = await batchSuggestCategoryByHistory(stillUncategorised);

    for (const r of needsCategory) {
      const normalized = normalizedMap.get(r.importHash);
      if (!normalized) continue;
      const catId =
        localRules.get(r.importHash) ??
        trigramSuggestions.get(r.importHash)?.categoryId;
      if (catId) categoryByHash.set(r.importHash, catId);
    }
  }

  // Attach suggested/existing categories + fold format-specific extras
  // into canonical fields the commit route persists directly.
  const rowsWithCategories = rowsWithDupeFlag.map((r) => ({
    ...r,
    // For duplicates: use existing DB category, falling back to the suggested one
    // For new rows: use the suggested category
    categoryId: r.existingCategoryId ?? categoryByHash.get(r.importHash) ?? null,
    // Flag when a category is freshly suggested (not already in DB)
    suggestedCategory: !r.existingCategoryId && categoryByHash.has(r.importHash),
    // Bank-supplied type — OFX TRNTYPE / QIF L / CSV Categories — written
    // verbatim to transactions.type.
    type: r.trnType ?? r.bankCategory ?? null,
    // Post-transaction running balance from CSV "Balance" column, written
    // verbatim to transactions.balance.
    balance: r.runningBalance ?? null,
    // Bank-supplied account identifier (CSV "Bank Account" column, QIF
    // !Account name). Sent through to commit so it can learn the alias
    // on first import.
    bankAccountId: r.qifAccount?.name ?? null,
  }));

  // Create pending import log
  const [log] = await db
    .insert(importLogs)
    .values({
      filename: file.name,
      format,
      institution,
      accountNumber,
      accountId: detectedAccountId,
      rowsParsed: rows.length,
      status: "pending",
    })
    .returning();

  return NextResponse.json({
    importLogId: log.id,
    format,
    rows: rowsWithCategories,
    detectedAccountId,
    institution,
    accountNumber,
  });
}
