import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getAccountBalanceTrend } from "@/lib/dashboard/account-balance-trend";

const querySchema = z.object({
  accountId: z.string().uuid(),
  days: z.coerce.number().int().min(1).max(60).default(7),
});

/** Daily-end balance series for one account over the past N
 * days (default 7, capped at 60). Powers the dashboard Account
 * widget's running-balance sparkline. */
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
    await getAccountBalanceTrend(parsed.data.accountId, parsed.data.days),
  );
}
