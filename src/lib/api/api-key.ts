import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";

/** Shared prefix for every plaintext API key issued by this app.
 *  Matches the `bk_` convention we tell operators to look for so
 *  they can spot a real key at a glance and greps for accidental
 *  commits are easy. */
export const API_KEY_PREFIX = "bk_";

/** Mint a fresh plaintext API key. Format: `bk_` + 32 bytes of
 *  URL-safe base64 (43 chars). Never persisted to disk — this
 *  value is shown to the operator ONCE at creation. */
export function generateApiKey(): string {
  const raw = randomBytes(32).toString("base64url");
  return `${API_KEY_PREFIX}${raw}`;
}

/** Hex SHA-256 of a plaintext key. Keys are already high-entropy
 *  so a plain digest is sufficient — no bcrypt / argon2 overhead
 *  needed. Same digest goes into the DB `key_hash` column at
 *  creation and is what the guard compares against at lookup. */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Verify a Bearer token from the `Authorization` header. Returns
 *  the row on match (touched with `lastUsedAt` best-effort), null
 *  otherwise. The plaintext must carry the `bk_` prefix — anything
 *  else is rejected without a DB round-trip so a leaked NextAuth
 *  JWT can't accidentally authenticate as an API key. */
export async function verifyBearer(plaintext: string): Promise<{
  id: string;
  role: string;
} | null> {
  if (!plaintext.startsWith(API_KEY_PREFIX)) return null;
  const hash = hashApiKey(plaintext);
  const [row] = await db
    .select({ id: apiKeys.id, role: apiKeys.role })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);
  if (!row) return null;
  // Fire-and-forget lastUsedAt bump. If it fails (DB busy, brief
  // lock) the next call will succeed — a couple of missed writes
  // are fine for a "last activity" heuristic.
  void db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch(() => {});
  return row;
}

/** Pull the plaintext bearer from a Request's `Authorization`
 *  header. Returns `null` when the header is absent or malformed
 *  — the caller falls back to session auth. */
export function readBearerToken(request: Request): string | null {
  const h = request.headers.get("authorization");
  if (!h) return null;
  const [scheme, ...rest] = h.split(" ");
  if (scheme.toLowerCase() !== "bearer" || rest.length === 0) return null;
  const token = rest.join(" ").trim();
  return token || null;
}
