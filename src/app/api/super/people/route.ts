import { NextResponse } from "next/server";
import {
  loadSuperPeople,
  saveSuperPeople,
  slugifyPersonKey,
} from "@/lib/super-people";
import { z } from "zod";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

/** GET /api/super/people
 *  Returns the ordered list of people tracked on the super page.
 *  Format: `{ people: [{ key, label }] }`.
 *  When the underlying store is empty, falls back to deriving from
 *  existing snapshots + the legacy label columns. */
export const GET = withAuth(async () => {
  const people = await loadSuperPeople();
  return NextResponse.json({ people });
});

const POST_BODY = z.object({
  label: z.string().min(1).max(60),
  /** Optional explicit key; otherwise derived from the label. */
  key: z.string().min(1).max(40).optional(),
});

/** POST /api/super/people
 *  Append a new person to the end of the list. Body: `{ label,
 *  key? }`. Auto-slugs the label into a key when omitted; if the
 *  resulting key collides with an existing one, appends a numeric
 *  suffix so the operator can pick whatever label they want without
 *  worrying about uniqueness. */
export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, POST_BODY);
  if (!parsed.ok) return parsed.response;

  const people = await loadSuperPeople();
  const taken = new Set(people.map((p) => p.key));
  let key = parsed.data.key ?? slugifyPersonKey(parsed.data.label);
  if (taken.has(key)) {
    // Disambiguate with a numeric suffix until free.
    let n = 2;
    while (taken.has(`${key}-${n}`)) n += 1;
    key = `${key}-${n}`;
  }
  const next = [...people, { key, label: parsed.data.label }];
  await saveSuperPeople(next);
  return NextResponse.json({ people: next });
});
