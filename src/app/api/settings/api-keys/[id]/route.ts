import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { withAdminAuthAndId } from "@/lib/api/route-guards";

/** DELETE — revoke an API key. The row is hard-deleted; a leaked
 *  key needs to stop working immediately, not be soft-flagged. */
export const DELETE = withAdminAuthAndId(async (id) => {
  const result = await db
    .delete(apiKeys)
    .where(eq(apiKeys.id, id))
    .returning({ id: apiKeys.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
