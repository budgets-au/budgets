import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  lastAdminGuard,
  validatePassword,
  validateRole,
  validateUsername,
} from "@/lib/user-rules";

function requesterId(session: unknown): string | null {
  const id = (session as { user?: { id?: string } } | null)?.user?.id;
  return id ?? null;
}

async function listAdminIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"));
  return rows.map((r) => r.id);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = requesterId(session);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  let body: {
    name?: unknown;
    username?: unknown;
    password?: unknown;
    role?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Partial<typeof users.$inferInsert> = {};

  if (body.username !== undefined) {
    const v = validateUsername(body.username);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch.username = (body.username as string).trim();
  }
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "Name must be a non-empty string." }, { status: 400 });
    }
    patch.name = body.name.trim();
  }
  if (body.password !== undefined) {
    const v = validatePassword(body.password);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch.passwordHash = await hash(body.password as string, 12);
  }
  if (body.role !== undefined) {
    const v = validateRole(body.role);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    // Demoting an admin? Make sure we're not stripping the last one.
    if (body.role !== "admin") {
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
    patch.role = body.role as "admin" | "member";
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
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
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const me = requesterId(session);
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

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
}
