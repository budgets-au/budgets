import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { accountTypeEnum } from "@/lib/api/enums";

const createSchema = z.object({
  name: z.string().min(1),
  type: accountTypeEnum,
  institution: z.string().optional(),
  accountNumberLast4: z.string().optional(),
  currency: z.string().default("AUD"),
  startingBalance: z.string().default("0"),
  startingDate: z.string().optional(),
  color: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // `?includeArchived=true` returns archived accounts alongside
  // visible ones. The dashboard Account widget uses it (the whole
  // point of pinning is that a hidden account stays visible).
  // Other callers (transactions filter, sidebar) want the
  // visible-only default.
  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get("includeArchived") === "true";

  const rows = await db
    .select()
    .from(accounts)
    .where(includeArchived ? undefined : eq(accounts.isArchived, false))
    .orderBy(asc(accounts.name));

  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data = createSchema.parse(body);

  const [row] = await db
    .insert(accounts)
    .values({
      ...data,
      currentBalance: data.startingBalance,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
