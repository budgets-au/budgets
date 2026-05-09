import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { scheduleSuggestionDismissals } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const createSchema = z.object({
  accountId: z.string().uuid(),
  normalizedPayee: z.string().min(1).max(500),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select({
      accountId: scheduleSuggestionDismissals.accountId,
      normalizedPayee: scheduleSuggestionDismissals.normalizedPayee,
      dismissedAt: scheduleSuggestionDismissals.dismissedAt,
    })
    .from(scheduleSuggestionDismissals);
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { accountId, normalizedPayee } = createSchema.parse(body);

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
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
}
