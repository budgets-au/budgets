import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import {
  DISPLAY_PREFS_DEFAULT,
  parseDisplayPrefs,
  type DisplayPrefs,
} from "@/lib/display-prefs";

/** Read the current display-prefs blob, merged with defaults so the
 * client gets a fully-populated DisplayPrefs every time. */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({ displayPrefs: appSettings.displayPrefs })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  const stored = rows[0]?.displayPrefs;
  return NextResponse.json(parseDisplayPrefs(stored ?? null));
}

/** Patch one or more pref keys. Request body is a partial
 * DisplayPrefs object; only keys present in the body are updated,
 * everything else is left untouched (deep-merge over the current
 * blob). Response is the full merged + defaulted blob so the
 * client's SWR cache lands with a complete picture. */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let patch: unknown;
  try {
    patch = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!patch || typeof patch !== "object") {
    return NextResponse.json(
      { error: "Body must be a JSON object" },
      { status: 400 },
    );
  }

  const existing = await db
    .select({ displayPrefs: appSettings.displayPrefs })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  const current = parseDisplayPrefs(existing[0]?.displayPrefs ?? null);
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
}

// Helper for typed clients (re-export so consumers don't have to
// reach into the lib path themselves).
export { DISPLAY_PREFS_DEFAULT, type DisplayPrefs };
