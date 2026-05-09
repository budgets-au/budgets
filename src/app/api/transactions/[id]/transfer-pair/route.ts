import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { manualPair, manualUnpair } from "@/lib/transfer-match";

const schema = z.object({
  pairId: z.string().uuid().nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();
  const { pairId } = schema.parse(body);

  if (pairId === null) {
    await manualUnpair(id);
  } else {
    if (pairId === id) {
      return NextResponse.json({ error: "Cannot pair a transaction with itself" }, { status: 400 });
    }
    await manualPair(id, pairId);
  }

  return NextResponse.json({ ok: true });
}
