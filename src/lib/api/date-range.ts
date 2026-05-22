import { NextResponse } from "next/server";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 365 * 12;

interface OkRange {
  ok: true;
  from: string;
  to: string;
}
interface ErrRange {
  ok: false;
  response: NextResponse<{ error: string }>;
}

/** Validate `?from=YYYY-MM-DD&to=YYYY-MM-DD` query params. Both
 *  required, both strict-format, and the range capped at 12 years to
 *  block accidental / hostile multi-decade scans.
 *
 *  Issue #51 — extracted from `/api/cashflow` so `/api/reports`,
 *  `/api/reports/cashflow`, `/api/reports/payee-totals`,
 *  `/api/reports/transactions-points`, `/api/transactions`, etc.
 *  share the same gate and the same error envelope. Caller threads
 *  the result through; on error, just return `parsed.response`.
 *
 *  Optional `allowAuto: true` accepts `from=auto` for the calendar
 *  brush's "span the whole dataset" mode. */
export function parseDateRange(
  searchParams: URLSearchParams,
  opts?: { allowAuto?: boolean },
): OkRange | ErrRange {
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "from and to are required" },
        { status: 400 },
      ),
    };
  }
  const fromAllowed = opts?.allowAuto && from === "auto";
  if ((!fromAllowed && !ISO_RE.test(from)) || !ISO_RE.test(to)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "from / to must be YYYY-MM-DD" },
        { status: 400 },
      ),
    };
  }
  if (!fromAllowed) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs < fromMs) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "from must be <= to" },
          { status: 400 },
        ),
      };
    }
    if ((toMs - fromMs) / 86_400_000 > MAX_RANGE_DAYS) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `range too large (max ${MAX_RANGE_DAYS} days)` },
          { status: 400 },
        ),
      };
    }
  }
  return { ok: true, from, to };
}
