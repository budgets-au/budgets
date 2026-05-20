import { NextResponse } from "next/server";
import { searchTicker } from "@/lib/investments/yahoo";
import { withAuth } from "@/lib/api/route-guards";

export const GET = withAuth(async (request) => {
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
});
