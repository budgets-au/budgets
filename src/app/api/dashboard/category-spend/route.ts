import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/lib/api/route-guards";
import { getCategorySpend } from "@/lib/dashboard/category-spend";

const querySchema = z.object({
  categoryId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  includeChildren: z.coerce.boolean().default(true),
});

/** Total + count for one category over the past N days (default
 * 30). Rolls up descendants by default, matching the cashflow
 * report's behaviour. Powers the dashboard Category-spend widget. */
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    categoryId: searchParams.get("categoryId"),
    days: searchParams.get("days") ?? undefined,
    includeChildren: searchParams.get("includeChildren") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid categoryId/days/includeChildren" },
      { status: 400 },
    );
  }
  return NextResponse.json(
    await getCategorySpend(
      parsed.data.categoryId,
      parsed.data.days,
      parsed.data.includeChildren,
    ),
  );
});
