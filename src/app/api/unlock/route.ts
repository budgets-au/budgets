import { NextResponse } from "next/server";
import { z } from "zod";
import { unlock, isUnlocked, dbExists } from "@/db";
import { validatePassphrase } from "@/lib/passphrase";
import { rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { parseJsonBody } from "@/lib/api/parse-body";

// Issue #58: parseJsonBody envelope so the wire error shape matches
// the rest of the API. validatePassphrase is still called below for
// the control-char rejection — zod alone can't express that.
const unlockSchema = z.object({
  passphrase: z.string(),
});

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

  const parsed = await parseJsonBody(request, unlockSchema);
  if (!parsed.ok) return parsed.response;
  const passphrase = parsed.data.passphrase;
  // validatePassphrase still runs because zod can't express the
  // control-char rejection — the same characters that would break
  // a PRAGMA key statement mid-quote (NUL, CR, LF).
  const validationError = validatePassphrase(passphrase);
  if (validationError) {
    return NextResponse.json(
      { ok: false, error: validationError },
      { status: 400 },
    );
  }

  const result = unlock(passphrase);
  if (!result.ok) {
    // Issue #47: `describeOpenError` distinguishes EACCES / EROFS /
    // ENOSPC / wrong-key in the wire body — useful for the operator
    // debugging a fresh deploy, but it's a pre-auth disclosure of
    // deployment-time filesystem state. Keep the wrong-passphrase
    // ambiguity on the wire (the operator-friendly string) and
    // redact the deploy-state messages to a generic body; the
    // detailed string still lands in the server log.
    const detail = result.error ?? "Failed to open the database.";
    const wireSafe = detail.includes("Wrong passphrase")
      ? detail
      : "Unable to open database — check the server log for details.";
    if (wireSafe !== detail) {
      console.error(`[unlock] ${detail}`);
    }
    return NextResponse.json(
      { ok: false, error: wireSafe },
      { status: 401 },
    );
  }
  // Successful unlock — clear the rate-limit counter so a legit user
  // who fat-fingered four times then got it right doesn't waste their
  // remaining budget for the rest of the minute.
  resetRateLimit("unlock:POST");
  return NextResponse.json({ ok: true });
}
