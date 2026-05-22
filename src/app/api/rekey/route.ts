import { NextResponse } from "next/server";
import { rekey } from "@/db";
import { validatePassphrase } from "@/lib/passphrase";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { withAdminAuth } from "@/lib/api/route-guards";

/**
 * Rotate the SQLCipher passphrase. Admin-only — rotating the
 * encryption key is a household-wide operation that should not be
 * available to member users. The endpoint validates the current
 * passphrase against the file (same path as /api/unlock) and then
 * issues PRAGMA rekey on the live connection. On success, future
 * starts must use the new passphrase; existing sessions keep
 * working since the connection is keyed with the new value in place.
 */
export const POST = withAdminAuth(async (request) => {
  // Throttle rekey attempts FIRST, before any work. Issue #50: previously
  // this ran after the passphrase validation + the (expensive) SQLCipher
  // decrypt probe, which gave the file comment's "slow a hostile admin
  // session" goal nothing to slow. Mirrors /api/unlock's correct
  // ordering — rate limit first, parse + key probe second.
  const rl = rateLimit("rekey:POST", { max: 5, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many rekey attempts. Try again in ${rl.retryAfter}s.`,
      },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const current =
    typeof body === "object" && body !== null && "current" in body
      ? (body as { current: unknown }).current
      : null;
  const next =
    typeof body === "object" && body !== null && "next" in body
      ? (body as { next: unknown }).next
      : null;
  if (typeof current !== "string" || typeof next !== "string") {
    return NextResponse.json(
      { ok: false, error: "Both current and next passphrases are required." },
      { status: 400 },
    );
  }
  // Same control-char rejection both unlock + rekey use — a rotated
  // key with a CR/LF/NUL embedded would break the next PRAGMA cycle
  // mid-statement just as easily as the initial unlock would.
  const currentValidation = validatePassphrase(current);
  if (currentValidation) {
    return NextResponse.json({ ok: false, error: currentValidation }, { status: 400 });
  }
  const nextValidation = validatePassphrase(next);
  if (nextValidation) {
    return NextResponse.json({ ok: false, error: nextValidation }, { status: 400 });
  }
  if (next.length < 8) {
    return NextResponse.json(
      { ok: false, error: "New passphrase must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (current === next) {
    return NextResponse.json(
      { ok: false, error: "New passphrase must differ from the current one." },
      { status: 400 },
    );
  }

  const result = rekey(current, next);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  resetRateLimit("rekey:POST");
  return NextResponse.json({ ok: true });
});
