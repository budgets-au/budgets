import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  loadSuperPeople,
  saveSuperPeople,
  slugifyPersonKey,
} from "@/lib/super-people";
import { z } from "zod";

/** GET /api/super/people
 *  Returns the ordered list of people tracked on the super page.
 *  Format: `{ people: [{ key, label }] }`.
 *  When the underlying store is empty, falls back to deriving from
 *  existing snapshots + the legacy label columns. */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const people = await loadSuperPeople();
  return NextResponse.json({ people });
}

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
export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = POST_BODY.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const people = await loadSuperPeople();
  const taken = new Set(people.map((p) => p.key));
  let key = body.data.key ?? slugifyPersonKey(body.data.label);
  if (taken.has(key)) {
    // Disambiguate with a numeric suffix until free.
    let n = 2;
    while (taken.has(`${key}-${n}`)) n += 1;
    key = `${key}-${n}`;
  }
  const next = [...people, { key, label: body.data.label }];
  await saveSuperPeople(next);
  return NextResponse.json({ people: next });
}
