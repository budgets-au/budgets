import { db } from "@/db";
import {
  appSettings,
  superannuationSnapshots,
  type SuperPerson,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

/** Default keys + labels used when the operator has never set up
 *  the super page. `self` is the only person seeded; the UI's "Add
 *  person" affordance covers everything else. */
const DEFAULT_PEOPLE: SuperPerson[] = [{ key: "self", label: "Me" }];

/** Read the ordered people list. Three sources, in priority order:
 *   1. `app_settings.super_people` — the authoritative store once
 *      the operator has touched the super page in v0.127+.
 *   2. Derived from existing `superannuation_snapshots.person`
 *      distinct values + the legacy `super_self_label` /
 *      `super_partner_label` columns for keys `self`/`partner`.
 *      Covers DBs that pre-date 0.127's people list.
 *   3. `DEFAULT_PEOPLE` (a single `self` entry) for a brand-new
 *      install where neither has been touched.
 *
 *  Pure read — no writes. The caller can persist whatever it likes
 *  via `saveSuperPeople`. */
export async function loadSuperPeople(): Promise<SuperPerson[]> {
  const [row] = await db
    .select({
      superPeople: appSettings.superPeople,
      selfLabel: appSettings.superSelfLabel,
      partnerLabel: appSettings.superPartnerLabel,
    })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);

  if (row?.superPeople && Array.isArray(row.superPeople) && row.superPeople.length > 0) {
    return row.superPeople;
  }

  // Derive from snapshots + legacy label columns.
  const snapshotPersons = await db
    .selectDistinct({ person: superannuationSnapshots.person })
    .from(superannuationSnapshots);

  if (snapshotPersons.length === 0) return DEFAULT_PEOPLE;

  const legacyLabels: Record<string, string | null | undefined> = {
    self: row?.selfLabel,
    partner: row?.partnerLabel,
  };
  // Stable order: "self" first, then "partner", then any others
  // alphabetically. Once the operator reorders via the UI, the
  // saved list overrides this initial sort.
  const ordering = (key: string) =>
    key === "self" ? 0 : key === "partner" ? 1 : 2;
  return snapshotPersons
    .map((s) => ({
      key: s.person,
      label: legacyLabels[s.person] ?? defaultLabelFor(s.person),
    }))
    .sort(
      (a, b) =>
        ordering(a.key) - ordering(b.key) || a.key.localeCompare(b.key),
    );
}

/** Pretty-print a person key when no explicit label has been set.
 *  Replaces hyphens/underscores with spaces and title-cases. */
function defaultLabelFor(key: string): string {
  if (key === "self") return "Me";
  if (key === "partner") return "Partner";
  return key
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Persist the ordered list. Upserts the singleton `app_settings`
 *  row in case it doesn't exist yet (fresh DB). */
export async function saveSuperPeople(people: SuperPerson[]): Promise<void> {
  // Insert-on-conflict so a brand-new DB without an existing
  // app_settings row still works.
  await db.run(sql`
    INSERT INTO app_settings (id, super_people, updated_at)
    VALUES (1, ${JSON.stringify(people)}, ${Date.now()})
    ON CONFLICT(id) DO UPDATE SET
      super_people = excluded.super_people,
      updated_at = excluded.updated_at
  `);
}

/** Generate a stable slug-style key from a free-text label. The
 *  caller should still check for collisions against the existing
 *  list. */
export function slugifyPersonKey(label: string): string {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "person"
  );
}
