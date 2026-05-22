import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, categories } from "@/db/schema";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
import {
  DISPLAY_PREFS_DEFAULT,
  parseDisplayPrefs,
  type DisplayPrefs,
} from "@/lib/display-prefs";

/** Build the initial pref blob for a fresh install. New operators
 * should land on a cashflow report with internal-transfer categories
 * already hidden — those rows are mostly zero-net noise (asset moves
 * between own accounts) and the per-category eye system means they
 * can always be un-hidden if wanted. */
async function computeInitialPrefs(): Promise<DisplayPrefs> {
  const transferCats = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.transferKind, "internal"));
  return {
    ...DISPLAY_PREFS_DEFAULT,
    cashflowExcludedCatIds: transferCats.map((c) => c.id),
  };
}

/** Read the current display-prefs blob, merged with defaults so the
 * client gets a fully-populated DisplayPrefs every time. */
export const GET = withAuth(async () => {
  const rows = await db
    .select({ displayPrefs: appSettings.displayPrefs })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  const stored = rows[0]?.displayPrefs;
  if (stored == null) {
    return NextResponse.json(await computeInitialPrefs());
  }
  return NextResponse.json(parseDisplayPrefs(stored));
});

// Issue #58: dynamic-key body, so the zod schema is a permissive
// `record<string, unknown>` — `parseDisplayPrefs` is the real
// gatekeeper for individual field shapes. The schema is here so the
// error envelope matches the rest of the API (BadRequestBody).
const patchSchema = z.record(z.string(), z.unknown());

/** Patch one or more pref keys. Request body is a partial
 * DisplayPrefs object; only keys present in the body are updated,
 * everything else is left untouched (deep-merge over the current
 * blob). Response is the full merged + defaulted blob so the
 * client's SWR cache lands with a complete picture. */
export const PATCH = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  const patch = parsed.data;

  const existing = await db
    .select({ displayPrefs: appSettings.displayPrefs })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  // First write applies the same dynamic defaults GET returns so the
  // operator's transfer-cat-hidden defaults survive their first
  // explicit patch (otherwise that patch would create the row over a
  // stock DISPLAY_PREFS_DEFAULT with empty cashflowExcludedCatIds).
  const current =
    existing[0]?.displayPrefs == null
      ? await computeInitialPrefs()
      : parseDisplayPrefs(existing[0].displayPrefs);
  // Re-parse the merged candidate to discard any unknown / wrongly-
  // typed keys the client tried to slip in. The parser is the single
  // gatekeeper for the schema.
  const next: DisplayPrefs = parseDisplayPrefs({
    ...current,
    ...(patch as Record<string, unknown>),
  });

  // Singleton row id=1 — upsert via onConflictDoUpdate matches the
  // existing pattern in src/db/index.ts for the sample-data flag.
  await db
    .insert(appSettings)
    .values({
      id: 1,
      displayPrefs: next as unknown as Partial<Record<string, unknown>>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        displayPrefs: next as unknown as Partial<Record<string, unknown>>,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json(next);
});

// Helper for typed clients (re-export so consumers don't have to
// reach into the lib path themselves).
export { DISPLAY_PREFS_DEFAULT, type DisplayPrefs };
