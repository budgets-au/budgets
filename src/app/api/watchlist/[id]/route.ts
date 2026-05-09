import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { watchlist } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: rawId } = await params;
  const idParse = z.string().uuid().safeParse(rawId);
  if (!idParse.success) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  await db.delete(watchlist).where(eq(watchlist.id, idParse.data));
  return NextResponse.json({ ok: true });
}
