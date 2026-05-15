import { NextResponse } from "next/server";
import { auth, isAdmin } from "@/lib/auth";
import {
  diskUsage,
  listBackups,
  readSchedule,
  takeBackup,
} from "@/lib/backup/sqlite-backup";

/** GET /api/backup — list backups newest-first plus the current
 * schedule config. Admin-only: the backup file is a full
 * unencrypted snapshot of every household member's data, so even
 * the filename listing is privileged. */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  try {
    return NextResponse.json({
      backups: listBackups(),
      schedule: readSchedule(),
      disk: await diskUsage(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/backup] GET failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** POST /api/backup — take a manual backup right now. Admin-only;
 * see GET. Returns the created entry so the UI can prepend it
 * without re-fetching. */
export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdmin(session)) {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  }
  try {
    const entry = await takeBackup("manual");
    return NextResponse.json({ ok: true, entry });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
