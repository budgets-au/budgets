import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth, isAdmin } from "@/lib/auth";
import { db } from "@/db";

/**
 * Refresh SQLite's query-planner statistics by running ANALYZE.
 *
 * SQLite picks indexes based on column-distribution stats stored in
 * `sqlite_stat1` / `sqlite_stat4`. The numbers go stale after big bulk
 * mutations (large imports, sample-data removal, restore) and the
 * planner can pick a worse plan than it would on fresh stats.
 * ANALYZE is cheap (seconds even on ~100k rows) and side-effect-free
 * apart from refreshing those tables.
 *
 * Surfaced as a button on Settings → Maintenance. Admin-only — the
 * operation touches every indexed table.
 */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json(
      { error: "Admin role required" },
      { status: 403 },
    );
  }
  const start = Date.now();
  await db.run(sql`ANALYZE`);
  const elapsedMs = Date.now() - start;
  return NextResponse.json({ ok: true, elapsedMs });
}
