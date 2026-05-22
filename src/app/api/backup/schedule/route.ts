import { NextResponse } from "next/server";
import { z } from "zod";
import { readSchedule, writeSchedule } from "@/lib/backup/sqlite-backup";
import { withAdminAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

// Issue #58: migrate from raw `request.json()` to the canonical
// `parseJsonBody` + zod schema so the error envelope matches the
// rest of the API (`BadRequestBody.issues[]`).
const patchSchema = z.object({
  enabled: z.boolean().optional(),
  intervalDays: z.number().positive().finite().optional(),
  retain: z.number().int().nonnegative().finite().optional(),
});

/** PATCH /api/backup/schedule — partial update of the singleton
 * schedule config. Admin-only; backup cadence is household-wide. Any
 * subset of {enabled, intervalDays, retain} is accepted; the scheduler
 * picks up the new values within ~60s. */
export const PATCH = withAdminAuth(async (request) => {
  const parsed = await parseJsonBody(request, patchSchema);
  if (!parsed.ok) return parsed.response;
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json(
      { error: "No valid fields supplied" },
      { status: 400 },
    );
  }
  writeSchedule(parsed.data);
  return NextResponse.json({ ok: true, schedule: readSchedule() });
});
