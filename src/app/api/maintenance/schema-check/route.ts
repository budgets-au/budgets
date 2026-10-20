import { NextResponse } from "next/server";
import { getSchemaCheck } from "@/db";
import { withAdminAuth } from "@/lib/api/route-guards";

/** Read-only migration/schema diagnostics for Settings → Maintenance. */
export const GET = withAdminAuth(async () => {
  const check = getSchemaCheck();
  if (!check) return NextResponse.json({ error: "Database is locked" }, { status: 423 });
  return NextResponse.json(check);
});
