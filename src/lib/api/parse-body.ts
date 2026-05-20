import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

/** Bad-request payload shape returned by every route migrated to
 * `parseJsonBody`. Stable so the client can rely on the `issues`
 * array for inline-field error rendering, not just a toast. */
export interface BadRequestBody {
  error: string;
  issues: Array<{
    path: string;
    message: string;
    code: string;
  }>;
}

/** Parse a JSON request body against a Zod schema. On success the
 *  caller continues with `parsed.data`; on failure the caller
 *  immediately returns `parsed.response`, a 400 carrying the zod
 *  issue tree.
 *
 *  Use anywhere a handler used to do `schema.parse(body)`
 *  unwrapped. The smart-monkey crawl (0.196.0+) discovered that
 *  pattern produces silent 500's with empty bodies whenever zod
 *  rejects — the client sees no useful error to surface. The
 *  initial migration in 0.200.0 covers `/api/scheduled`; other
 *  routes adopt this incrementally as the monkey surfaces their
 *  silent-500 paths.
 *
 *  Discriminated-union return shape keeps the call site
 *  type-narrow: `if (!parsed.ok) return parsed.response;`. */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<
  { ok: true; data: T } | { ok: false; response: NextResponse<BadRequestBody> }
> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Invalid JSON body",
          issues: [
            { path: "", message: "request body was not valid JSON", code: "invalid_json" },
          ],
        },
        { status: 400 },
      ),
    };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Invalid request body",
          issues: result.error.issues.map((i) => ({
            path: i.path.map(String).join("."),
            message: i.message,
            code: i.code,
          })),
        },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

/** Convenience: return a 400 with the same `BadRequestBody` shape
 *  for hand-rolled validation that runs AFTER the schema check
 *  (cross-field invariants the zod schema can't express without
 *  contorted refinements — e.g. `type=transfer` requiring
 *  `transferToAccountId`). Keeps the client's error-render path
 *  uniform across schema and post-schema failures. */
export function badRequest(
  message: string,
  field: string = "",
): NextResponse<BadRequestBody> {
  return NextResponse.json(
    {
      error: message,
      issues: [{ path: field, message, code: "cross_field" }],
    },
    { status: 400 },
  );
}

/** Just enough of zod to keep the type-checker happy when callers
 *  pass an inferred schema. Re-exported so call sites don't need
 *  to add a zod import just to type-annotate. */
export type { ZodType } from "zod";
export { z };
