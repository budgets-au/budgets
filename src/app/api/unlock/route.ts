import { NextResponse } from "next/server";
import { unlock, isUnlocked, dbExists } from "@/db";
import { validatePassphrase } from "@/lib/passphrase";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";

/**
 * Web-side unlock endpoint. Accepts `{ passphrase }` JSON, runs it
 * through the SQLCipher driver, and on success leaves the keyed
 * connection in module memory for the rest of the process's life.
 *
 * Deliberately NOT auth-gated — the auth flow itself reads from the
 * users table, which can't load until the DB is unlocked. The
 * passphrase IS the gate.
 *
 * GET reports lock status so the UI can decide whether to redirect
 * the user away from /unlock once another tab has already unlocked.
 */
export async function GET() {
  // dbExists distinguishes "first-run, the passphrase you type creates
  // a fresh encrypted DB" from "existing DB, type the right passphrase
  // to open it". The unlock page renders different copy + button
  // labels accordingly.
  return NextResponse.json({
    unlocked: isUnlocked(),
    dbExists: dbExists(),
  });
}

export async function POST(request: Request) {
  // Rate-limit the unlock endpoint to dampen brute-force attempts.
  // Single global bucket per process — sufficient for a household
  // app where the legit user types a handful of attempts at worst;
  // anything past that is either a typo loop (slow down, breathe)
  // or a brute-force scan (slow down, attacker). 5 attempts per
  // 60-second window then 429 + Retry-After.
  const rl = rateLimit("unlock:POST", { max: 5, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many unlock attempts. Try again in ${rl.retryAfter}s.`,
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
  const passphrase =
    typeof body === "object" && body !== null && "passphrase" in body
      ? (body as { passphrase: unknown }).passphrase
      : null;
  const validationError = validatePassphrase(passphrase);
  if (validationError) {
    return NextResponse.json(
      { ok: false, error: validationError },
      { status: 400 },
    );
  }

  const result = unlock(passphrase as string);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 401 },
    );
  }
  // Successful unlock — clear the rate-limit counter so a legit user
  // who fat-fingered four times then got it right doesn't waste their
  // remaining budget for the rest of the minute.
  resetRateLimit("unlock:POST");
  return NextResponse.json({ ok: true });
}
