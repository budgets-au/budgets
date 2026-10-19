import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { attachmentsHealthCheck } from "@/lib/attachments/health";

/** GET /api/settings/attachments-health
 *  — Writes, reads back, and deletes a short-lived `.probe-*.tmp`
 *    file at the root of the attachments store so the operator can
 *    see whether the volume is actually usable BEFORE their first
 *    receipt upload hits a 500.
 *
 *    Called live from the Settings → Databases tab panel; a failing
 *    result raises an inline banner there. The route is also safe
 *    for a startup smoke-test from a dashboard widget or an
 *    external healthcheck URL. */
export const GET = withAuth(async () => {
  const result = await attachmentsHealthCheck();
  // Always 200 — the body carries the ok/error so the UI can
  // render the banner. A non-2xx would hide the diagnostic from
  // SWR's happy path.
  return NextResponse.json(result);
});
