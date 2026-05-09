import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { validateUsername, validatePassword, validateRole } from "@/lib/user-rules";

/** Admin-only. The user manager surfaces the password hash never;
 * everything else is fair game for the Settings UI. */
function isAdmin(session: unknown): boolean {
  const role = (session as { user?: { role?: string } } | null)?.user?.role;
  return role === "admin";
}

export async function GET() {
  const session = await auth();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt);
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: unknown; username?: unknown; password?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const u = validateUsername(body.username);
  if (!u.ok) return NextResponse.json({ error: u.error }, { status: 400 });
  const p = validatePassword(body.password);
  if (!p.ok) return NextResponse.json({ error: p.error }, { status: 400 });
  const r = validateRole(body.role);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  const username = (body.username as string).trim();
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : username;
  const passwordHash = await hash(body.password as string, 12);

  // Reject duplicates with a friendlier 409 than letting the unique
  // index throw. The race between this check and the insert is fine
  // — the unique constraint is the source of truth.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  if (existing) {
    return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
  }

  const [row] = await db
    .insert(users)
    .values({
      name,
      username,
      passwordHash,
      role: body.role as "admin" | "member",
    })
    .returning({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    });

  return NextResponse.json(row, { status: 201 });
}
