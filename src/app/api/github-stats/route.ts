import { NextResponse } from "next/server";
import { extractGithubStats } from "./extract";
import { withAuth } from "@/lib/api/route-guards";

const PACKAGE_URL =
  "https://github.com/budgets-au/budgets/pkgs/container/budgets";

const UA =
  "Mozilla/5.0 (compatible; budgets/1.0; +https://github.com/budgets-au/budgets)";

interface SuccessResp {
  downloads: number | null;
  stars: number | null;
}

interface ErrorResp {
  error: string;
}

/** Scrapes the public GHCR package page for total downloads
 *  + the repo's star count. No auth required — both numbers
 *  are visible in the page HTML. See `./extract` for the
 *  regex-based parsing; this route is just the network
 *  fetch + soft-fail envelope.
 *
 *  Cached for an hour via the Next route-segment `revalidate` —
 *  the upstream counters tick slowly, so hourly granularity
 *  is plenty and de-dupes SWR subscribers per node.
 *
 *  On parse failure the route still returns 200 with
 *  `{ downloads: null, stars: null }` so individual stats can
 *  fall back to "—"; on network failure it returns
 *  `{ error: "…" }` (still status 200) so the dashboard
 *  doesn't break. */
export const revalidate = 3600;

export const GET = withAuth(async () => {
  try {
    const res = await fetch(PACKAGE_URL, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `GitHub ${res.status}` },
        { status: 200 },
      );
    }
    const html = await res.text();
    return NextResponse.json(extractGithubStats(html));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 200 });
  }
});
