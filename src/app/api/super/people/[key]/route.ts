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
    let created = false;
    // If the key didn't exist in the list (e.g. a snapshot already
    // uses it but no people-list entry was ever created), append it
    // so the rename "lands". Mirrors the lazy-init pattern in
    // loadSuperPeople. Issue #91: 404 if the key is in NEITHER the
    // people list NOR any existing snapshot — silent upsert on a
    // typo'd key was the bug.
    if (!people.some((p) => p.key === key)) {
      const [existing] = await db
        .select({ id: superannuationSnapshots.id })
        .from(superannuationSnapshots)
        .where(eq(superannuationSnapshots.person, key))
        .limit(1);
      if (!existing) {
        return NextResponse.json(
          { error: `Person key not found: ${key}` },
          { status: 404 },
        );
      }
      next.push({ key, label: parsed.data.label });
      created = true;
    }
    await saveSuperPeople(next);
    return NextResponse.json({ people: next, kind: created ? "created" : "renamed" });
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
    const existed = people.some((p) => p.key === key);
    const next = people.filter((p) => p.key !== key);
    // Snapshot delete via .returning() so we know if the key was
    // also referenced there. Issue #91: 404 if the key was in
    // neither the people list NOR any snapshot — silently returning
    // 200 on a typo was the bug.
    const deletedSnapshots = await db
      .delete(superannuationSnapshots)
      .where(eq(superannuationSnapshots.person, key))
      .returning({ id: superannuationSnapshots.id });
    if (!existed && deletedSnapshots.length === 0) {
      return NextResponse.json(
        { error: `Person key not found: ${key}` },
        { status: 404 },
      );
    }
    await saveSuperPeople(next);
    return NextResponse.json({ people: next });
  },
);
