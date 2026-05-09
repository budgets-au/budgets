import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rekey } from "@/db";

/**
 * Rotate the SQLCipher passphrase. Auth-gated — only a logged-in user
 * can change the key. The endpoint validates the current passphrase
 * against the file (same path as /api/unlock) and then issues
 * PRAGMA rekey on the live connection. On success, future starts must
 * use the new passphrase; existing sessions keep working since the
 * connection is keyed with the new value in place.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
  return NextResponse.json({ ok: true });
}
