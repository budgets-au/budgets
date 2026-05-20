import { NextResponse } from "next/server";
import { db } from "@/db";
import { payeeRules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withAuthAndId } from "@/lib/api/route-guards";

export const DELETE = withAuthAndId(async (id) => {
  const [row] = await db.delete(payeeRules).where(eq(payeeRules.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
});
