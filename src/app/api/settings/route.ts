import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { appSettings, type TaxConfig } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const taxConfigSchema = z.object({
  // Map keys arrive as strings via JSON; `Number(k)` on read.
  wfhHoursByFy: z.record(z.string(), z.number().min(0)).optional(),
  categoryRules: z
    .record(
      z.string().uuid(),
      z.object({
        workUsePct: z.number().min(0).max(100),
        bundledInWfh: z.boolean(),
        note: z.string().optional(),
      }),
    )
    .optional(),
});

const updateSchema = z.object({
  taxConfig: taxConfigSchema.optional(),
});

const EMPTY_TAX_CONFIG: TaxConfig = { wfhHoursByFy: {}, categoryRules: {} };

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [row] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  return NextResponse.json({
    taxConfig: row?.taxConfig ?? EMPTY_TAX_CONFIG,
  });
}

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const data = updateSchema.parse(body);

  const updates: Partial<typeof appSettings.$inferInsert> = { updatedAt: new Date() };

  if (data.taxConfig !== undefined) {
    // Shallow-merge per top-level key so the client can send a single
    // category-rule update without resending the whole config. Each top-level
    // map (wfhHoursByFy / categoryRules) is itself spread, so individual
    // category/year keys merge independently.
    const [existing] = await db
      .select({ taxConfig: appSettings.taxConfig })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    const current: TaxConfig = existing?.taxConfig ?? EMPTY_TAX_CONFIG;
    const merged: TaxConfig = {
      wfhHoursByFy: { ...current.wfhHoursByFy, ...(data.taxConfig.wfhHoursByFy ?? {}) },
      categoryRules: { ...current.categoryRules, ...(data.taxConfig.categoryRules ?? {}) },
    };
    updates.taxConfig = merged;
  }

  await db
    .insert(appSettings)
    .values({ id: 1, ...updates })
    .onConflictDoUpdate({ target: appSettings.id, set: updates });

  return NextResponse.json({ ok: true });
}
