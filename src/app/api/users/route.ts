import { NextResponse } from "next/server";
import { z } from "zod";
import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  USERNAME_MIN,
  USERNAME_MAX,
  USERNAME_RE,
  PASSWORD_MIN,
  VALID_ROLES,
} from "@/lib/user-rules";
import { withAdminAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

// Issue #58: zod schema mirroring the standalone validators in
// `lib/user-rules.ts`. The validators stay around for the unit
// tests (`user-rules.test.ts`) — this schema is just the route-
// boundary version so the error envelope matches the rest of the
// API (`BadRequestBody.issues[]`).
const createSchema = z.object({
  name: z.string().optional(),
  username: z
    .string()
    .trim()
    .min(USERNAME_MIN, "Username is required.")
    .max(USERNAME_MAX, `Username must be ${USERNAME_MAX} characters or fewer.`)
    .regex(USERNAME_RE, "Username may only contain letters, digits, dot, underscore, or dash."),
  password: z
    .string()
    .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters.`),
  role: z.enum(VALID_ROLES, { message: "Role must be 'admin' or 'member'." }),
});

export const GET = withAdminAuth(async () => {
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
});

export const POST = withAdminAuth(async (request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  const username = data.username; // already trimmed by the schema
  const name = data.name?.trim() || username;
  const passwordHash = await hash(data.password, 12);

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
      role: data.role,
    })
    .returning({
      id: users.id,
      name: users.name,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    });

  return NextResponse.json(row, { status: 201 });
});
