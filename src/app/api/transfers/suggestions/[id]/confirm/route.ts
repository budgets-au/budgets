import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { transferSuggestions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { manualPair } from "@/lib/transfer-match";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
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
}
