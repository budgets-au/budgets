import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { accountTypeEnum } from "@/lib/api/enums";
import { withAuth } from "@/lib/api/route-guards";

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

export const GET = withAuth(async (request) => {
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
});

export const POST = withAuth(async (request) => {
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
});
