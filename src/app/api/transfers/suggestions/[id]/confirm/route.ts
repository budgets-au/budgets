import { NextResponse } from "next/server";
import { db } from "@/db";
import { transferSuggestions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { manualPair } from "@/lib/transfer-match";
import { withAuthAndId } from "@/lib/api/route-guards";

export const POST = withAuthAndId(async (id) => {
  const [row] = await db
    .select({
      transactionId: transferSuggestions.transactionId,
      candidateId: transferSuggestions.candidateId,
    })
    .from(transferSuggestions)
    .where(eq(transferSuggestions.id, id))
    .limit(1);

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await manualPair(row.transactionId, row.candidateId);

  return NextResponse.json({ ok: true });
});
