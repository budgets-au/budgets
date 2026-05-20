import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { transferKindEnum } from "@/lib/api/enums";

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["income", "expense"]),
  color: z.string().default("#94a3b8"),
  parentId: z.string().uuid().optional().nullable(),
  transferKind: transferKindEnum.optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");

  let query = db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .$dynamic();
  if (type === "income" || type === "expense") {
    query = query.where(eq(categories.type, type));
  }

  const rows = await query;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data = createSchema.parse(body);

  const [row] = await db.insert(categories).values(data).returning();
  return NextResponse.json(row, { status: 201 });
}
