import { NextResponse } from "next/server";
import { unlock, isUnlocked, dbExists } from "@/db";

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
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Passphrase is required" },
      { status: 400 },
    );
  }

  const result = unlock(passphrase);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 401 },
    );
  }
  return NextResponse.json({ ok: true });
}
