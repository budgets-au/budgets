import { NextResponse } from "next/server";
import { db } from "@/db";
import { superannuationSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadSuperPeople, saveSuperPeople } from "@/lib/super-people";
import { z } from "zod";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

const PATCH_BODY = z.object({
  label: z.string().min(1).max(60),
});

/** PATCH /api/super/people/:key
 *  Rename an existing person. Body: `{ label }`. */
export const PATCH = withAuth<{ params: Promise<{ key: string }> }>(
  async (request, { params }) => {
    const { key } = await params;
    const parsed = await parseJsonBody(request, PATCH_BODY);
    if (!parsed.ok) return parsed.response;

    const people = await loadSuperPeople();
    const next = people.map((p) =>
      p.key === key ? { ...p, label: parsed.data.label } : p,
    );
    // If the key didn't exist in the list (e.g. a snapshot already
    // uses it but no people-list entry was ever created), append it
    // so the rename "lands". Mirrors the lazy-init pattern in
    // loadSuperPeople.
    if (!next.some((p) => p.key === key)) {
      next.push({ key, label: parsed.data.label });
    }
    await saveSuperPeople(next);
    return NextResponse.json({ people: next });
  },
);

/** DELETE /api/super/people/:key
 *
 *  Remove a person from the list. Their snapshots are deleted as
 *  part of the same call — leaving orphan rows behind would let
 *  them resurface via `loadSuperPeople`'s snapshot-derived fallback
 *  on the next page load. */
export const DELETE = withAuth<{ params: Promise<{ key: string }> }>(
  async (_request, { params }) => {
    const { key } = await params;

    const people = await loadSuperPeople();
    const next = people.filter((p) => p.key !== key);
    await saveSuperPeople(next);
    await db
      .delete(superannuationSnapshots)
      .where(eq(superannuationSnapshots.person, key));
    return NextResponse.json({ people: next });
  },
);
