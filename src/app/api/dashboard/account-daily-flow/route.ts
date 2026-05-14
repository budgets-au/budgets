import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccountDailyFlow } from "@/lib/dashboard/account-daily-flow";

const querySchema = z.object({
  accountId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(60).default(7),
});

/** Per-day in/out totals for one account over the past N days
 * (default 7, capped at 60). Powers the dashboard Account widget's
 * mini bar chart. Days with no activity get zero-filled so the
 * client renders a stable strip. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    accountId: searchParams.get("accountId"),
    days: searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid accountId/days" },
      { status: 400 },
    );
  }
  return NextResponse.json(
    await getAccountDailyFlow(parsed.data.accountId, parsed.data.days),
  );
}
