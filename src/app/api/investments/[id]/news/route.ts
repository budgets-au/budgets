import { NextResponse } from "next/server";
import { db } from "@/db";
import { investments, investmentNews } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { getNews } from "@/lib/investments/yahoo";
import { withAuthAndId } from "@/lib/api/route-guards";

/** Refetch from Yahoo if the most recent cache row for this symbol is
 *  older than this. Yahoo's news cadence isn't sub-hourly for most
 *  tickers — 24h is the right tradeoff between freshness and not
 *  hammering Yahoo. The user can force a refetch via the dashboard
 *  refresh button (not implemented yet — manual cache-bust by
 *  deleting rows is the fallback). */
const NEWS_TTL_MS = 24 * 60 * 60 * 1000;

/** GET /api/investments/:id/news
 *
 * Recent news/announcements headlines for the investment's symbol.
 * Cached in the `investment_news` table; the cache is refreshed on
 * demand when the most recent fetch is older than NEWS_TTL_MS.
 *
 * Yahoo's news endpoint is unauthenticated and can be flaky — when
 * the upstream fetch fails we fall back to returning whatever's in
 * the cache (with `stale: true` on the response) rather than 5xx'ing.
 *
 * Response: `{ news: NewsItem[]; fetchedAt: number; stale: boolean }`
 * where `fetchedAt` is the unix-ms of the newest cache row.
 */
export const GET = withAuthAndId(async (id, request) => {
  // Look up the symbol to query. Investments are user-owned; an
  // authenticated user is allowed to see news for any of their
  // tickers (no per-user scoping in the schema today).
  const [row] = await db
    .select({ symbol: investments.symbol, name: investments.name })
    .from(investments)
    .where(eq(investments.id, id))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const symbol = row.symbol.toUpperCase();
  const companyName = row.name;

  // Cache freshness check: pull the most recent fetched_at for this
  // symbol. If it's within TTL, serve from cache only.
  const [newest] = await db
    .select({ fetchedAt: investmentNews.fetchedAt })
    .from(investmentNews)
    .where(eq(investmentNews.symbol, symbol))
    .orderBy(desc(investmentNews.fetchedAt))
    .limit(1);
  const now = Date.now();
  const cacheAgeMs = newest ? now - newest.fetchedAt.getTime() : Infinity;
  let stale = false;

  if (cacheAgeMs >= NEWS_TTL_MS) {
    try {
      const fresh = await getNews(symbol, companyName);
      // Dedup-insert: only insert items whose (symbol, uuid) pair
      // isn't already cached. Bumping `fetched_at` on existing rows
      // keeps the staleness check honest even when nothing new
      // appeared upstream.
      if (fresh.length > 0) {
        const existing = await db
          .select({ uuid: investmentNews.uuid })
          .from(investmentNews)
          .where(eq(investmentNews.symbol, symbol));
        const have = new Set(existing.map((e) => e.uuid));
        const toInsert = fresh
          .filter((n) => !have.has(n.uuid))
          .map((n) => ({
            symbol,
            uuid: n.uuid,
            title: n.title,
            publisher: n.publisher,
            link: n.link,
            publishedAt:
              n.publishedAt !== null ? new Date(n.publishedAt) : null,
            thumbnail: n.thumbnail,
          }));
        if (toInsert.length > 0) {
          await db.insert(investmentNews).values(toInsert);
        }
      }
      // Sentinel-bump: even if nothing new came back, touch the
      // newest cached row so we don't refetch on every request when
      // Yahoo has nothing. Do this only when we have a prior row.
      if (newest && fresh.length === 0) {
        await db
          .update(investmentNews)
          .set({ fetchedAt: new Date() })
          .where(
            and(
              eq(investmentNews.symbol, symbol),
              eq(investmentNews.fetchedAt, newest.fetchedAt),
            ),
          );
      }
    } catch {
      // Upstream failure → fall back to whatever's in the cache.
      stale = true;
    }
  }

  // Read back the full cache for this symbol — newest first.
  const cached = await db
    .select({
      uuid: investmentNews.uuid,
      title: investmentNews.title,
      publisher: investmentNews.publisher,
      link: investmentNews.link,
      publishedAt: investmentNews.publishedAt,
      thumbnail: investmentNews.thumbnail,
      fetchedAt: investmentNews.fetchedAt,
    })
    .from(investmentNews)
    .where(eq(investmentNews.symbol, symbol))
    .orderBy(desc(investmentNews.publishedAt))
    .limit(20);

  const newestFetch = cached.reduce<number>(
    (max, r) => Math.max(max, r.fetchedAt.getTime()),
    0,
  );

  return NextResponse.json({
    news: cached.map((c) => ({
      uuid: c.uuid,
      title: c.title,
      publisher: c.publisher,
      link: c.link,
      publishedAt: c.publishedAt?.getTime() ?? null,
      thumbnail: c.thumbnail,
    })),
    fetchedAt: newestFetch || null,
    stale,
  });
});
