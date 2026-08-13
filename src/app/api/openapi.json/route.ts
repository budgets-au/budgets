import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { getOpenApiDocument } from "@/lib/openapi/registry";

/** OpenAPI 3 spec for the Budgets HTTP API. Generated from the
 *  Zod schemas registered in `src/lib/openapi/registry.ts` at
 *  module-load time; served cached. Included in OPS_ALLOWLIST so
 *  an ops-scoped key can programmatically discover its own
 *  endpoint surface. */
export const GET = withAuth(async () => {
  return NextResponse.json(getOpenApiDocument());
});
