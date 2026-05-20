import { NextResponse } from "next/server";
import { db } from "@/db";
import { scheduleSuggestionDismissals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const createSchema = z.object({
  accountId: z.string().uuid(),
  normalizedPayee: z.string().min(1).max(500),
});

export const GET = withAuth(async () => {
  const rows = await db
    .select({
      accountId: scheduleSuggestionDismissals.accountId,
      normalizedPayee: scheduleSuggestionDismissals.normalizedPayee,
      dismissedAt: scheduleSuggestionDismissals.dismissedAt,
    })
    .from(scheduleSuggestionDismissals);
  return NextResponse.json(rows);
});

export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const { accountId, normalizedPayee } = parsed.data;

  // Idempotent — re-dismissing just refreshes dismissedAt.
  const [row] = await db
    .insert(scheduleSuggestionDismissals)
    .values({ accountId, normalizedPayee })
    .onConflictDoUpdate({
      target: [
        scheduleSuggestionDismissals.accountId,
        scheduleSuggestionDismissals.normalizedPayee,
      ],
      set: { dismissedAt: new Date() },
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
});

export const DELETE = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const normalizedPayee = searchParams.get("normalizedPayee");
  if (!accountId || !normalizedPayee) {
    return NextResponse.json(
      { error: "accountId and normalizedPayee required" },
      { status: 400 },
    );
  }

  await db
    .delete(scheduleSuggestionDismissals)
    .where(
      and(
        eq(scheduleSuggestionDismissals.accountId, accountId),
        eq(scheduleSuggestionDismissals.normalizedPayee, normalizedPayee),
      ),
    );

  return NextResponse.json({ ok: true });
});
