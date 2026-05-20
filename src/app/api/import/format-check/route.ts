import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { accounts, importLogs } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const bodySchema = z.object({
  format: z.string().min(1),
  // Optional — when omitted/empty, only the global flag is computed
  // (used by the parse step, before the user has resolved accounts).
  accountIds: z.array(z.string().uuid()).default([]),
});

/**
 * Pre-commit guard for the import flow: report which of the
 * resolved-target accounts have never seen this file's format before.
 * The UI uses this to put a confirmation dialog in front of the user
 * when they're about to commit, say, an OFX file to an account whose
 * history is purely CSV — a frequent footgun because the importHash
 * shape differs across formats and re-imports won't dedupe.
 */
export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { format, accountIds } = parsed.data;

  // Per-format committed row counts — used by the dialog to show the
  // user the breakdown of their existing data before they confirm a new
  // format. {qif: 0, csv: 1456, ofx: 234} etc.
  const formatRows = await db
    .select({
      format: importLogs.format,
      rows: sql<number>`COALESCE(SUM(${importLogs.rowsImported}), 0)`,
    })
    .from(importLogs)
    .where(eq(importLogs.status, "committed"))
    .groupBy(importLogs.format);
  const totalsByFormat: Record<string, number> = {};
  for (const r of formatRows) totalsByFormat[r.format] = r.rows ?? 0;
  const formatNewGlobally = (totalsByFormat[format] ?? 0) === 0;

  if (accountIds.length === 0) {
    return NextResponse.json({
      format,
      formatNewGlobally,
      totalsByFormat,
      newFormatAccounts: [],
    });
  }

  // For each requested account, the set of distinct formats that have
  // committed at least one row to it in the past. accounts that are
  // missing from this result haven't been imported into at all yet.
  const rows = await db
    .select({
      accountId: importLogs.accountId,
      accountName: accounts.name,
      format: importLogs.format,
      committed: sql<number>`SUM(${importLogs.rowsImported})`,
    })
    .from(importLogs)
    .innerJoin(accounts, eq(accounts.id, importLogs.accountId))
    .where(
      and(
        inArray(importLogs.accountId, accountIds),
        eq(importLogs.status, "committed"),
      ),
    )
    .groupBy(importLogs.accountId, accounts.name, importLogs.format);

  const formatsByAccount = new Map<
    string,
    { name: string; formats: Set<string>; rows: number }
  >();
  for (const r of rows) {
    if (!r.accountId) continue;
    const cur = formatsByAccount.get(r.accountId) ?? {
      name: r.accountName ?? "?",
      formats: new Set<string>(),
      rows: 0,
    };
    if (r.committed > 0) cur.formats.add(r.format);
    cur.rows += r.committed ?? 0;
    formatsByAccount.set(r.accountId, cur);
  }

  // accountIds the caller asked about that have *never* seen this
  // exact format committed to them. Includes brand-new accounts (no
  // prior imports at all) so the user is reassured a fresh account
  // import is doing the right thing.
  const newFormatAccounts: {
    accountId: string;
    name: string;
    priorFormats: string[];
  }[] = [];
  for (const id of accountIds) {
    const entry = formatsByAccount.get(id);
    if (!entry) {
      const [acc] = await db
        .select({ name: accounts.name })
        .from(accounts)
        .where(eq(accounts.id, id))
        .limit(1);
      newFormatAccounts.push({
        accountId: id,
        name: acc?.name ?? "?",
        priorFormats: [],
      });
      continue;
    }
    if (!entry.formats.has(format)) {
      newFormatAccounts.push({
        accountId: id,
        name: entry.name,
        priorFormats: Array.from(entry.formats).sort(),
      });
    }
  }

  return NextResponse.json({
    format,
    formatNewGlobally,
    totalsByFormat,
    newFormatAccounts,
  });
});
