import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { APP_VERSION } from "@/lib/version";
import { isUnlocked } from "@/db";
import { getActiveProfile } from "@/lib/db-profiles";

/** Operational health snapshot. Non-sensitive by design — every
 *  field here is safe for a scope-restricted key to read. Feed it
 *  to an external liveness probe / dashboard / assistant. */
export const GET = withAuth(async () => {
  const mem = process.memoryUsage();
  const profile = (() => {
    try {
      return getActiveProfile().id;
    } catch {
      // If the profile registry hasn't been touched (first-run
      // fringe), don't 500 the health probe.
      return null;
    }
  })();
  return NextResponse.json({
    version: APP_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    dbUnlocked: isUnlocked(),
    activeProfile: profile,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
    },
    nodeVersion: process.version,
  });
});
