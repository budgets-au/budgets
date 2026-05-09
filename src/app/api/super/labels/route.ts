import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  person: z.enum(["self", "partner"]),
  label: z.string().max(40),
});

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await db
    .select({
      selfLabel: appSettings.superSelfLabel,
      partnerLabel: appSettings.superPartnerLabel,
    })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  return NextResponse.json({
    selfLabel: row?.selfLabel ?? null,
    partnerLabel: row?.partnerLabel ?? null,
  });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { person, label } = updateSchema.parse(body);
  const trimmed = label.trim();
  const value = trimmed === "" ? null : trimmed;

  const updates =
    person === "self"
      ? { superSelfLabel: value, updatedAt: new Date() }
      : { superPartnerLabel: value, updatedAt: new Date() };

  await db
    .insert(appSettings)
    .values({ id: 1, ...updates })
    .onConflictDoUpdate({ target: appSettings.id, set: updates });

  return NextResponse.json({ ok: true });
}
