import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { getRecentLogs, type LogLevel } from "@/lib/log-buffer";

const LEVEL_SET = new Set<LogLevel>([
  "log",
  "info",
  "warn",
  "error",
  "debug",
]);

/** Serve the in-process console ring buffer. Query params:
 *   ?limit=200     — clamped [1, 1000] by getRecentLogs.
 *   ?level=warn,error  — comma-separated allowlist; omit for all.
 *
 *  Guarded by `withAuth` — an ops-scoped key can hit this
 *  (see the OPS_ALLOWLIST in route-guards). */
export const GET = withAuth(async (request) => {
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const rawLevel = url.searchParams.get("level");

  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
  const levels = rawLevel
    ? rawLevel
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is LogLevel => LEVEL_SET.has(s as LogLevel))
    : undefined;

  const lines = getRecentLogs({
    limit: Number.isFinite(limit) ? (limit as number) : undefined,
    levels: levels && levels.length > 0 ? levels : undefined,
  });
  return NextResponse.json({ lines });
});
