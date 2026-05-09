import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pairTransfersInWindow } from "@/lib/transfer-match";

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const result = await pairTransfersInWindow({});
  return NextResponse.json(result);
}
