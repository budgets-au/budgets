import { NextResponse } from "next/server";
import { withAuth } from "@/lib/api/route-guards";
import { pairTransfersInWindow } from "@/lib/transfer-match";

export const POST = withAuth(async () => {
  const result = await pairTransfersInWindow({});
  return NextResponse.json(result);
});
