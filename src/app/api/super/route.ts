import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { superannuationSnapshots } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

// `person` is a free-text key matching `superannuation_snapshots.person`.
// Loosened from the legacy `z.enum(["self","partner"])` in 0.128.3
// because the N-people super page (0.127) lets the operator add
// arbitrary keys via slugifyPersonKey — and the old enum was silently
// failing the parse on any new key, causing the GET filter to fall
// through to "return ALL snapshots" instead of filtering by person.
const PERSON = z.string().min(1).max(60);

const createSchema = z.object({
  fyEndYear: z.number().int().min(1990).max(2200),
  balance: z.string(),
  contributions: z.string().default("0"),
  person: PERSON.default("self"),
  fundName: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const personParam = searchParams.get("person");
  const personFilter = PERSON.safeParse(personParam);

  const query = db
    .select()
    .from(superannuationSnapshots)
    .orderBy(asc(superannuationSnapshots.fyEndYear));
  const rows = personFilter.success
    ? await query.where(eq(superannuationSnapshots.person, personFilter.data))
    : await query;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data = createSchema.parse(body);

  const [row] = await db
    .insert(superannuationSnapshots)
    .values({
      fyEndYear: data.fyEndYear,
      balance: data.balance,
      contributions: data.contributions,
      person: data.person,
      fundName: data.fundName ?? null,
      notes: data.notes ?? null,
    })
    .returning();
  return NextResponse.json(row, { status: 201 });
}
