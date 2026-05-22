import { NextResponse } from "next/server";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { eq } from "drizzle-orm";
import { withAuthAndId } from "@/lib/api/route-guards";

export const DELETE = withAuthAndId(async (id) => {
  // Issue #67: 404 when no row matched.
  const deleted = await db
    .delete(watchlist)
    .where(eq(watchlist.id, id))
    .returning({ id: watchlist.id });
  if (deleted.length === 0) {
    return NextResponse.json({ error: "Watchlist row not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
