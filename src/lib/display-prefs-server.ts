import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import {
  DISPLAY_PREFS_DEFAULT,
  parseDisplayPrefs,
  type DisplayPrefs,
} from "./display-prefs";

/** Server-side reader for the singleton display-prefs blob. Used by
 * server components (page routes) that need to consult feature flags
 * before rendering — the client-side `useDisplayPrefs` hook can't run
 * during SSR. Falls back to defaults when the row is missing or the
 * payload is malformed, matching the GET /api/display-prefs contract. */
export async function getDisplayPrefs(): Promise<DisplayPrefs> {
  const rows = await db
    .select({ displayPrefs: appSettings.displayPrefs })
    .from(appSettings)
    .where(eq(appSettings.id, 1));
  const stored = rows[0]?.displayPrefs;
  if (stored == null) return { ...DISPLAY_PREFS_DEFAULT };
  return parseDisplayPrefs(stored);
}
