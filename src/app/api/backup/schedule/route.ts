import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readSchedule, writeSchedule } from "@/lib/backup/sqlite-backup";

/** PATCH /api/backup/schedule — partial update of the singleton
 * schedule config. Validation is permissive: any subset of
 * {enabled, intervalDays, retain} is accepted, anything else is
 * dropped. The scheduler picks up the new values within ~60s. */
export async function PATCH(request: Request) {
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
  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { ok: false, error: "Body must be an object" },
      { status: 400 },
    );
  }
  const b = body as Record<string, unknown>;
  const patch: Partial<{
    enabled: boolean;
    intervalDays: number;
    retain: number;
  }> = {};
  if (typeof b.enabled === "boolean") patch.enabled = b.enabled;
  if (typeof b.intervalDays === "number" && Number.isFinite(b.intervalDays) && b.intervalDays > 0) {
    patch.intervalDays = b.intervalDays;
  }
  if (typeof b.retain === "number" && Number.isFinite(b.retain) && b.retain >= 0) {
    patch.retain = Math.floor(b.retain);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid fields supplied" },
      { status: 400 },
    );
  }
  writeSchedule(patch);
  return NextResponse.json({ ok: true, schedule: readSchedule() });
}
