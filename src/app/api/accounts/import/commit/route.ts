import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
];

const rowSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["checking", "savings", "credit", "loan", "cash"]),
  institution: z.string().optional(),
  accountNumberLast4: z.string().optional(),
  startingBalance: z.string().default("0"),
  startingDate: z.string().optional(),
  isArchived: z.boolean().default(false),
  // When set, the row updates the named account's anchor balance instead of
  // inserting a new row.
  existingId: z.string().uuid().nullable().optional(),
});

const bodySchema = z.object({
  rows: z.array(rowSchema),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { rows } = bodySchema.parse(body);

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
  let updated = 0;
  for (const r of toUpdate) {
    const patch: Partial<typeof accounts.$inferInsert> = {
      startingBalance: r.startingBalance,
      currentBalance: r.startingBalance,
    };
    if (r.startingDate) patch.startingDate = r.startingDate;
    await db.update(accounts).set(patch).where(eq(accounts.id, r.existingId!));
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
  }

  return NextResponse.json({ created, updated });
}
