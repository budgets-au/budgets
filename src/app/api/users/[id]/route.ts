import { NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  lastAdminGuard,
  USERNAME_MIN,
  USERNAME_MAX,
  USERNAME_RE,
  PASSWORD_MIN,
  VALID_ROLES,
} from "@/lib/user-rules";
import { withAdminAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

// Issue #58 + #45: migrated to `withAdminAuthAndId` (which gives the
// 401-vs-403 split a non-admin caller should see) + parseJsonBody +
// zod. Previous hand-rolled `if (!isAdmin(session)) return 401`
// returned 401 for any non-admin (authenticated or not) — the
// `withAdminAuth` wrapper now correctly distinguishes the two.

const patchSchema = z
  .object({
    name: z.string().trim().min(1, "Name must be a non-empty string.").optional(),
    username: z
      .string()
      .trim()
      .min(USERNAME_MIN, "Username is required.")
      .max(USERNAME_MAX, `Username must be ${USERNAME_MAX} characters or fewer.`)
      .regex(USERNAME_RE, "Username may only contain letters, digits, dot, underscore, or dash.")
      .optional(),
    password: z
      .string()
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`)
      .optional(),
    role: z.enum(VALID_ROLES, { message: "Role must be 'admin' or 'member'." }).optional(),
  })
  .refine(
    (v) => Object.values(v).some((x) => x !== undefined),
    { message: "Nothing to update." },
  );

async function listAdminIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"));
  return rows.map((r) => r.id);
}

async function requesterId(): Promise<string | null> {
  const session = await auth();
  return (session as { user?: { id?: string } } | null)?.user?.id ?? null;
}

export const PATCH = withAdminAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // The route guard confirmed the requester is an admin. Re-fetch
  // their id so we can keep them from demoting themselves into a
  // zero-admins state. (See #79 for the broader auth() double-call
  // hygiene — not relevant to this route's correctness.)
  const me = await requesterId();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const patch: Partial<typeof users.$inferInsert> = {};
  if (data.username !== undefined) patch.username = data.username;
  if (data.name !== undefined) patch.name = data.name;
  if (data.password !== undefined) {
    patch.passwordHash = await hash(data.password, 12);
  }
  if (data.role !== undefined) {
    // Demoting an admin? Make sure we're not stripping the last one.
    if (data.role !== "admin") {
      const admins = await listAdminIds();
      const guard = lastAdminGuard({
        action: "demote",
        targetUserId: id,
        requesterUserId: me,
        currentAdmins: admins,
      });
      if (!guard.ok) {
        return NextResponse.json({ error: guard.error }, { status: 409 });
      }
    }
    patch.role = data.role;
  }

  // Username collision: friendlier than letting the unique index throw.
  if (patch.username) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, patch.username))
      .limit(1);
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
    }
  }

  const [row] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, id))
    .returning({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    });
  if (!row) return NextResponse.json({ error: "User not found." }, { status: 404 });
  return NextResponse.json(row);
});

export const DELETE = withAdminAuthAndId(async (id) => {
  const me = await requesterId();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admins = await listAdminIds();
  const guard = lastAdminGuard({
    action: "delete",
    targetUserId: id,
    requesterUserId: me,
    currentAdmins: admins,
  });
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: 409 });

  const [row] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (!row) return NextResponse.json({ error: "User not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
});
