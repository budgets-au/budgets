import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { withAdminAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

/**
 * GET /api/settings/brave-search-key
 *
 * Reports whether a Brave Search subscription token is currently
 * configured AND which source the resolver would use. The actual
 * token bytes are NEVER returned — the UI only needs to know
 * "configured / not configured" + the source so the operator can
 * see env-var overrides vs the DB-set value.
 *
 * Source values:
 *   - "env" → `BRAVE_SEARCH_API_KEY` env var is set (overrides DB).
 *   - "db"  → no env var, but a value is set in `app_settings`.
 *   - "none" → neither set; the announcements panel runs Yahoo-only.
 *
 * Admin-gated because this exposes the configured-state of an
 * org-wide secret. Member users shouldn't see whether the
 * household has paid for / configured a Brave key.
 */
export const GET = withAdminAuth(async () => {
  const envSet = !!process.env.BRAVE_SEARCH_API_KEY?.trim();
  let dbSet = false;
  try {
    const [row] = await db
      .select({ key: appSettings.braveSearchApiKey })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    dbSet = !!row?.key?.trim();
  } catch {
    /* db not ready / table missing pre-migration — treat as not-set */
  }
  const source: "env" | "db" | "none" = envSet ? "env" : dbSet ? "db" : "none";
  return NextResponse.json({
    configured: envSet || dbSet,
    source,
  });
});

const patchSchema = z.object({
  // null clears the DB value; empty string is also accepted and
  // treated as "clear" (the operator wiping the input + saving).
  key: z.string().nullable(),
});

/**
 * PATCH /api/settings/brave-search-key
 *
 * Sets (or clears) the DB-stored Brave Search subscription token.
 * Pass `{ key: "<token>" }` to set; `{ key: null }` or
 * `{ key: "" }` to clear.
 *
 * The env var (`BRAVE_SEARCH_API_KEY`) takes precedence at
 * resolve-time, so setting via PATCH while the env var is also
 * set has no functional effect — but is still allowed (no error)
 * so the value is in place if the env var is later removed.
 *
 * Admin-gated; the key is an org-wide secret.
 */
export const PATCH = withAdminAuth(async (request) => {
  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  const raw = parsed.data.key;
  const next = raw === null || raw.trim() === "" ? null : raw.trim();

  // Singleton row pattern — INSERT with id=1 ON CONFLICT DO UPDATE.
  // The settings row is created by the seeder on first unlock, but
  // belt-and-braces in case this PATCH lands before that runs.
  await db
    .insert(appSettings)
    .values({ id: 1, braveSearchApiKey: next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { braveSearchApiKey: next, updatedAt: new Date() },
    });

  const envSet = !!process.env.BRAVE_SEARCH_API_KEY?.trim();
  return NextResponse.json({
    ok: true,
    configured: !!next || envSet,
    source: envSet ? "env" : next ? "db" : "none",
  });
});
