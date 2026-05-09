import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchTicker } from "@/lib/investments/yahoo";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  if (q.trim().length < 1) return NextResponse.json([]);

  try {
    const results = await searchTicker(q);
    return NextResponse.json(results);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Search failed" },
      { status: 502 },
    );
  }
}
