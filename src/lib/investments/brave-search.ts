/** Brave Search API — supplemental news source for the
 *  investment-detail Announcements panel. Yahoo Finance's curated
 *  feed is still the primary source; Brave broadens coverage (broker
 *  blogs, ASX wires, niche financial outlets Yahoo doesn't index)
 *  and surfaces a snippet ("description") under each headline so the
 *  operator can triage without clicking through.
 *
 *  Key env var: `BRAVE_SEARCH_API_KEY` (Brave's
 *  X-Subscription-Token). Unset → fetcher returns `[]` after a
 *  single console.log, so installs without a key keep working (Yahoo
 *  carries the panel on its own).
 *
 *  Quota: free tier is 2000 q/month, 1 q/sec. The API route's 24h
 *  per-symbol cache smooths most of that — at one fetch per symbol
 *  per day, the typical household tracking ~10 tickers spends ~300
 *  queries / month. */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { NewsItem } from "./yahoo";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";

/** Minimal Brave response shape — captures the fields we read.
 *  Brave returns much more (faqs, infobox, mixed-type rankings) but
 *  for news enrichment we only need `web.results[].{title, url,
 *  description, age, profile}`. */
interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
  /** Brave's human-readable freshness string e.g. "2 days ago",
   *  "5 hours ago", "March 12, 2026". Parsed into a unix-ms via
   *  `parseBraveAge`. */
  age?: string;
  /** Optional profile metadata (publisher name + favicon). When
   *  absent we fall back to the URL's hostname. */
  profile?: {
    name?: string;
    img?: string;
  };
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[];
  };
}

/** Track whether we've already warned about a missing API key, so
 *  the log line doesn't flood. */
let warnedMissingKey = false;

/** Stable per-row uuid: SHA-256 hex of the result URL. Same URL
 *  always produces the same uuid → safe to dedup against the
 *  `(symbol, uuid)` unique index on `investment_news`. */
export function urlToUuid(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/** Parse Brave's `age` string into a unix-ms timestamp. Brave
 *  varies the shape:
 *    - "5 hours ago", "2 days ago", "3 weeks ago", "6 months ago"
 *    - "March 12, 2026" (older results)
 *    - undefined / empty
 *  Anything we can't parse returns null; the caller renders
 *  `publishedAt ?? "Unknown date"` or similar. */
export function parseBraveAge(
  age: string | undefined,
  now: number = Date.now(),
): number | null {
  if (!age) return null;
  const trimmed = age.trim();
  // Relative form: "<n> <unit> ago"
  const rel = trimmed.match(
    /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i,
  );
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const MS: Record<string, number> = {
      second: 1_000,
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 7 * 86_400_000,
      // Months/years are calendar-approximate; close enough for a
      // sort key.
      month: 30 * 86_400_000,
      year: 365 * 86_400_000,
    };
    const ms = MS[unit];
    if (!ms) return null;
    return now - n * ms;
  }
  // Absolute form: try Date.parse. Brave uses "March 12, 2026"-style
  // strings which Date.parse handles.
  const abs = Date.parse(trimmed);
  return Number.isFinite(abs) ? abs : null;
}

/** Hostname of a URL or null if parsing fails. Used as the
 *  publisher fallback when Brave doesn't include a profile.name. */
export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Build the search query for a given ticker. The company name is
 *  the higher-signal half ("Commonwealth Bank" beats "CBA.AX" for
 *  recall); fall back to the ticker if no name is available.
 *  Quoted for exact-phrase match, then append " stock news" to bias
 *  the result set towards financial coverage rather than the
 *  company's own marketing pages. */
export function buildQuery(symbol: string, companyName: string | null): string {
  const trimmed = companyName?.trim();
  if (trimmed && trimmed.length >= 2) {
    return `"${trimmed}" stock news`;
  }
  return `"${symbol}" stock news`;
}

/** Map a single Brave web result to our shared `NewsItem` shape.
 *  Returns null when the result is missing critical fields (no
 *  url or no title — Brave occasionally returns sparse entries). */
export function toNewsItem(
  r: BraveWebResult,
  now: number = Date.now(),
): NewsItem | null {
  if (!r.url || !r.title) return null;
  return {
    uuid: urlToUuid(r.url),
    title: r.title,
    publisher: r.profile?.name ?? hostnameOf(r.url),
    link: r.url,
    publishedAt: parseBraveAge(r.age, now),
    thumbnail: r.profile?.img ?? null,
    description: r.description ?? null,
    source: "web",
  };
}

/** Resolve the active Brave Search API key. Precedence:
 *    1. `BRAVE_SEARCH_API_KEY` env var (container override).
 *    2. `app_settings.brave_search_api_key` (user-set via Settings
 *       → General).
 *    3. `undefined` (no key — fetcher returns [] gracefully).
 *
 *  Reads the DB lazily; failures (table missing on first migration,
 *  DB locked, etc.) silently fall through to undefined so the
 *  no-key install path stays solid. */
export async function resolveBraveApiKey(): Promise<string | undefined> {
  const fromEnv = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const [row] = await db
      .select({ key: appSettings.braveSearchApiKey })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1);
    const fromDb = row?.key?.trim();
    return fromDb || undefined;
  } catch {
    return undefined;
  }
}

/** Recent web-search hits for a ticker. Returns `[]` (gracefully)
 *  when the API key is missing, the upstream errors, or the
 *  response has no results. The API route treats the empty case
 *  the same as Yahoo returning nothing — Yahoo's parallel branch
 *  still feeds the panel. */
export async function searchInvestmentNews(
  symbol: string,
  companyName: string | null,
  count = 20,
  // Hook for tests — defaults to env+DB resolution at call time.
  apiKey: string | undefined = undefined,
): Promise<NewsItem[]> {
  if (apiKey === undefined) {
    apiKey = await resolveBraveApiKey();
  }
  if (!apiKey) {
    if (!warnedMissingKey) {
      console.log(
        "[brave-search] BRAVE_SEARCH_API_KEY is unset — web-source announcements disabled. Yahoo Finance continues to feed the panel.",
      );
      warnedMissingKey = true;
    }
    return [];
  }
  const q = buildQuery(symbol, companyName);
  const url = `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(q)}&count=${count}&freshness=pm`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
      },
    });
  } catch (e) {
    console.error("[brave-search] upstream fetch failed:", e);
    return [];
  }
  if (!res.ok) {
    console.error(
      `[brave-search] upstream ${res.status} for symbol=${symbol}`,
    );
    return [];
  }
  let data: BraveSearchResponse;
  try {
    data = (await res.json()) as BraveSearchResponse;
  } catch (e) {
    console.error("[brave-search] response parse failed:", e);
    return [];
  }
  const results = data.web?.results ?? [];
  const now = Date.now();
  const out: NewsItem[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const item = toNewsItem(r, now);
    if (!item) continue;
    if (seen.has(item.uuid)) continue;
    seen.add(item.uuid);
    out.push(item);
    if (out.length === count) break;
  }
  return out;
}
