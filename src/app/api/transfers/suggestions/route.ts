import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { db } from "@/db";
import { accounts, transactions, transferSuggestions } from "@/db/schema";
import { alias } from "drizzle-orm/sqlite-core";
import { and, desc, eq, isNull } from "drizzle-orm";

export const GET = withAuth(async () => {
  const t1 = alias(transactions, "t1");
  const t2 = alias(transactions, "t2");
  const a1 = alias(accounts, "a1");
  const a2 = alias(accounts, "a2");

  const rows = await db
    .select({
      id: transferSuggestions.id,
      score: transferSuggestions.score,
      createdAt: transferSuggestions.createdAt,
      aId: t1.id,
      aDate: t1.date,
      aAmount: t1.amount,
      aPayee: t1.payee,
      aAccountName: a1.name,
      aAccountColor: a1.color,
      bId: t2.id,
      bDate: t2.date,
      bAmount: t2.amount,
      bPayee: t2.payee,
      bAccountName: a2.name,
      bAccountColor: a2.color,
    })
    .from(transferSuggestions)
    .innerJoin(t1, eq(t1.id, transferSuggestions.transactionId))
    .innerJoin(t2, eq(t2.id, transferSuggestions.candidateId))
    .innerJoin(a1, eq(a1.id, t1.accountId))
    .innerJoin(a2, eq(a2.id, t2.accountId))
    .where(and(isNull(t1.transferPairId), isNull(t2.transferPairId)))
    .orderBy(desc(transferSuggestions.score), desc(transferSuggestions.createdAt));

  return NextResponse.json(rows);
});
