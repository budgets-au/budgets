import { NextResponse } from "next/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { withAdminAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";
import { generateApiKey, hashApiKey } from "@/lib/api/api-key";

/** GET — list API keys as METADATA ONLY. The plaintext key is
 *  never stored, so the operator can only see it at creation
 *  time; this list surfaces `id / name / role / scope / createdAt /
 *  lastUsedAt` so keys are recognisable and revoke-able. */
export const GET = withAdminAuth(async () => {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      role: apiKeys.role,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .orderBy(desc(apiKeys.createdAt));
  return NextResponse.json(rows);
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(64),
  role: z.enum(["admin", "member"]).default("admin"),
  scope: z.enum(["full", "ops"]).default("full"),
});

/** POST — mint a fresh key. The RESPONSE INCLUDES the plaintext
 *  under `key` — the ONLY time it will ever appear. The operator
 *  copies it into their client and stores it themselves; the DB
 *  keeps only the SHA-256 digest. */
export const POST = withAdminAuth(async (request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const { name, role, scope } = parsed.data;

  const plaintext = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      name,
      role,
      scope,
      keyHash: hashApiKey(plaintext),
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      role: apiKeys.role,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
    });
  return NextResponse.json({ ...row, key: plaintext }, { status: 201 });
});
