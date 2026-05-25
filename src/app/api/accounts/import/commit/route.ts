import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, bankBalances } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accountTypeEnum } from "@/lib/api/enums";
import { CATEGORICAL_PALETTE } from "@/lib/colours";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
import { chunkedExec } from "@/lib/api/chunked";

const COLORS = CATEGORICAL_PALETTE;

const balancePointSchema = z.object({
  date: z.string(),
  balance: z.string(),
});

const rowSchema = z.object({
  name: z.string().min(1),
  type: accountTypeEnum,
  institution: z.string().optional(),
  accountNumberLast4: z.string().optional(),
  startingBalance: z.string().default("0"),
  startingDate: z.string().optional(),
  isArchived: z.boolean().default(false),
  // When set, the row updates the named account's anchor balance instead of
  // inserting a new row.
  existingId: z.string().uuid().nullable().optional(),
  /** Full daily series the bank gave us — persisted into
   *  bank_balances after the account row is upsert. Optional for
   *  back-compat with clients that don't yet send it. */
  balanceSeries: z.array(balancePointSchema).optional().default([]),
});

const bodySchema = z.object({
  rows: z.array(rowSchema),
});

export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, bodySchema);
  if (!parsed.ok) return parsed.response;
  const { rows } = parsed.data;

  if (!rows.length) {
    return NextResponse.json({ created: 0, updated: 0 });
  }

  const toUpdate = rows.filter((r) => r.existingId);
  const toInsert = rows.filter((r) => !r.existingId);

  // Updates re-anchor the existing account: starting_balance + starting_date
  // (when provided) plus current_balance, so the import becomes the new
  // source of truth for both historical reconstruction and forward
  // projection. Other fields (name, type, colour, …) are left intact —
  // re-running an import shouldn't clobber names the user has renamed.
  //
  // Archive flip: the row's own `isArchived` derives from a "Closing
  // date" in the CSV. A CSV row without one means "this account is
  // live"; with one means "this account is closed". Use that to set
  // is_archived on update too — so re-importing a current statement
  // un-archives an account previously archived by mistake, and a CSV
  // marked closed re-archives correctly.
  // Track (committedRow → resolved accountId) pairs so the
  // bank_balances upsert below can attach each series to the right
  // account. Update rows already know their accountId (existingId);
  // insert rows get one back from .returning().
  const seriesTargets: Array<{
    accountId: string;
    series: Array<{ date: string; balance: string }>;
  }> = [];

  let updated = 0;
  for (const r of toUpdate) {
    const patch: Partial<typeof accounts.$inferInsert> = {
      startingBalance: r.startingBalance,
      currentBalance: r.startingBalance,
      isArchived: r.isArchived,
    };
    if (r.startingDate) patch.startingDate = r.startingDate;
    await db.update(accounts).set(patch).where(eq(accounts.id, r.existingId!));
    seriesTargets.push({ accountId: r.existingId!, series: r.balanceSeries });
    updated += 1;
  }

  let created = 0;
  if (toInsert.length) {
    const inserted = await db
      .insert(accounts)
      .values(
        toInsert.map((row, i) => ({
          name: row.name,
          type: row.type,
          institution: row.institution,
          accountNumberLast4: row.accountNumberLast4,
          startingBalance: row.startingBalance,
          currentBalance: row.startingBalance,
          startingDate: row.startingDate,
          isArchived: row.isArchived,
          color: COLORS[i % COLORS.length],
        }))
      )
      .returning({ id: accounts.id });
    created = inserted.length;
    // Match returned ids back to their source rows in order (drizzle
    // preserves insert order in the returning result).
    inserted.forEach((row, i) => {
      seriesTargets.push({
        accountId: row.id,
        series: toInsert[i].balanceSeries,
      });
    });
  }

  // Persist the bank-reported daily series. ON CONFLICT DO UPDATE so
  // re-imports refresh the recorded balance for any given day rather
  // than duplicating (UNIQUE on account_id + date). chunkedExec keeps
  // multi-year exports under SQLite's 32766-param cap — 5 fields per
  // row × 1500 rows = 7500 params per chunk.
  let balancesUpserted = 0;
  for (const { accountId, series } of seriesTargets) {
    if (series.length === 0) continue;
    await chunkedExec(series, 1500, (slice) =>
      db
        .insert(bankBalances)
        .values(
          slice.map((p) => ({
            accountId,
            date: p.date,
            balance: p.balance,
            source: "csv-import",
          })),
        )
        .onConflictDoUpdate({
          target: [bankBalances.accountId, bankBalances.date],
          set: { balance: sql`excluded.balance` },
        }),
    );
    balancesUpserted += series.length;
  }

  return NextResponse.json({ created, updated, balancesUpserted });
});
