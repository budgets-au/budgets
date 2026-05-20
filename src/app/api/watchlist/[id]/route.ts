import { NextResponse } from "next/server";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withAuthAndId } from "@/lib/api/route-guards";

export const DELETE = withAuthAndId(async (id) => {
  await db.delete(watchlist).where(eq(watchlist.id, id));
  return NextResponse.json({ ok: true });
});
