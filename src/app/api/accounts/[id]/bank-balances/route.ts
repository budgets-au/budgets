import { NextResponse } from "next/server";
import { db } from "@/db";
import { bankBalances } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { withAuthAndId } from "@/lib/api/route-guards";

/** GET /api/accounts/[id]/bank-balances — return the bank-reported
 *  daily closing-balance series for one account, ASC by date.
 *
 *  Captured by the accounts CSV import (see
 *  `/api/accounts/import/commit/route.ts`). No UI consumes this yet
 *  — endpoint exists so a future reconciliation report can compare
 *  `accounts.startingBalance + Σ tracked amount on/before date`
 *  against `bank_balances.balance` per day and flag drift. */
export const GET = withAuthAndId(async (id) => {
  const rows = await db
    .select({
      date: bankBalances.date,
      balance: bankBalances.balance,
      source: bankBalances.source,
    })
    .from(bankBalances)
    .where(eq(bankBalances.accountId, id))
    .orderBy(asc(bankBalances.date));
  return NextResponse.json(rows);
});
