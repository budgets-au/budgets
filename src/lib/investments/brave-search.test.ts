import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildQuery,
  hostnameOf,
  parseBraveAge,
  searchInvestmentNews,
  toNewsItem,
  urlToUuid,
} from "./brave-search";

describe("urlToUuid", () => {
  it("is stable across calls for the same URL", () => {
    const a = urlToUuid("https://example.com/article/1");
    const b = urlToUuid("https://example.com/article/1");
    expect(a).toBe(b);
  });

  it("differs for different URLs", () => {
    const a = urlToUuid("https://example.com/article/1");
    const b = urlToUuid("https://example.com/article/2");
    expect(a).not.toBe(b);
  });

  it("returns a 64-char hex string (SHA-256 hex digest)", () => {
    expect(urlToUuid("https://example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hostnameOf", () => {
  it("strips the leading 'www.' prefix", () => {
    expect(hostnameOf("https://www.example.com/foo")).toBe("example.com");
  });

  it("returns the bare host when no www. prefix", () => {
    expect(hostnameOf("https://news.example.com/foo")).toBe("news.example.com");
  });

  it("returns null for unparseable URLs", () => {
    expect(hostnameOf("not a url")).toBeNull();
    expect(hostnameOf("")).toBeNull();
  });
});

describe("parseBraveAge", () => {
  const NOW = 1_700_000_000_000;

  it("returns null for undefined / empty", () => {
    expect(parseBraveAge(undefined, NOW)).toBeNull();
    expect(parseBraveAge("", NOW)).toBeNull();
  });

  it("parses relative forms (hours / days / weeks / months / years)", () => {
    expect(parseBraveAge("5 hours ago", NOW)).toBe(NOW - 5 * 3_600_000);
    expect(parseBraveAge("2 days ago", NOW)).toBe(NOW - 2 * 86_400_000);
    expect(parseBraveAge("3 weeks ago", NOW)).toBe(
      NOW - 3 * 7 * 86_400_000,
    );
    // 30-day approximation for months — close enough as a sort key.
    expect(parseBraveAge("6 months ago", NOW)).toBe(
      NOW - 6 * 30 * 86_400_000,
    );
    expect(parseBraveAge("1 year ago", NOW)).toBe(NOW - 365 * 86_400_000);
  });

  it("handles singular and plural units", () => {
    expect(parseBraveAge("1 hour ago", NOW)).toBe(NOW - 3_600_000);
    expect(parseBraveAge("1 hours ago", NOW)).toBe(NOW - 3_600_000);
  });

  it("parses absolute date forms via Date.parse", () => {
    const result = parseBraveAge("March 12, 2026", NOW);
    expect(result).not.toBeNull();
    expect(result).toBe(Date.parse("March 12, 2026"));
  });

  it("returns null for unparseable garbage", () => {
    expect(parseBraveAge("yesterday-ish", NOW)).toBeNull();
    expect(parseBraveAge("right before lunch", NOW)).toBeNull();
  });
});

describe("buildQuery", () => {
  it("quotes the company name and appends ' stock news' when available", () => {
    expect(buildQuery("CBA.AX", "Commonwealth Bank")).toBe(
      '"Commonwealth Bank" stock news',
    );
  });

  it("falls back to the quoted ticker when no company name", () => {
    expect(buildQuery("CBA.AX", null)).toBe('"CBA.AX" stock news');
  });

  it("falls back when company name is too short to be discriminating", () => {
    expect(buildQuery("X", "X")).toBe('"X" stock news');
  });

  it("trims whitespace from the company name", () => {
    expect(buildQuery("CBA.AX", "  Commonwealth Bank  ")).toBe(
      '"Commonwealth Bank" stock news',
    );
  });
});

describe("toNewsItem", () => {
  it("returns null when url or title is missing", () => {
    expect(toNewsItem({ title: "no url" })).toBeNull();
    expect(toNewsItem({ url: "https://example.com" })).toBeNull();
  });

  it("maps a full Brave result", () => {
    const item = toNewsItem({
      title: "CBA Q3 results",
      url: "https://www.example.com/cba",
      description: "Profit up 10%, dividend held.",
      age: "2 days ago",
      profile: { name: "Example News", img: "https://example.com/icon.png" },
    });
    expect(item).not.toBeNull();
    expect(item!.title).toBe("CBA Q3 results");
    expect(item!.link).toBe("https://www.example.com/cba");
    expect(item!.description).toBe("Profit up 10%, dividend held.");
    expect(item!.publisher).toBe("Example News");
    expect(item!.thumbnail).toBe("https://example.com/icon.png");
    expect(item!.source).toBe("web");
    expect(item!.uuid).toMatch(/^[0-9a-f]{64}$/);
    expect(item!.publishedAt).not.toBeNull();
  });

  it("falls back to hostname when profile.name is missing", () => {
    const item = toNewsItem({
      title: "CBA Q3",
      url: "https://news.example.com/cba",
    });
    expect(item!.publisher).toBe("news.example.com");
    expect(item!.description).toBeNull();
    expect(item!.thumbnail).toBeNull();
    expect(item!.publishedAt).toBeNull();
  });
});

describe("searchInvestmentNews", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("returns [] when no API key is provided", async () => {
    const result = await searchInvestmentNews("CBA.AX", "Commonwealth Bank", 20, undefined);
    expect(result).toEqual([]);
  });

  it("calls Brave with the right header + query when key is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Headline 1",
                url: "https://example.com/1",
                description: "Snippet 1",
                age: "1 hour ago",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = fetchMock;
    const result = await searchInvestmentNews(
      "CBA.AX",
      "Commonwealth Bank",
      10,
      "fake-key",
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Headline 1");
    expect(result[0].source).toBe("web");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toContain("https://api.search.brave.com/res/v1/web/search");
    expect(calledUrl).toContain("freshness=pm");
    expect(calledUrl).toContain("count=10");
    expect(
      (calledInit as RequestInit).headers as Record<string, string>,
    ).toMatchObject({
      Accept: "application/json",
      "X-Subscription-Token": "fake-key",
    });
  });

  it("returns [] on upstream 4xx/5xx without throwing", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("Forbidden", { status: 403 }),
    );
    const result = await searchInvestmentNews("X", "X", 10, "fake-key");
    expect(result).toEqual([]);
  });

  it("returns [] on network error without throwing", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ENETDOWN"));
    const result = await searchInvestmentNews("X", "X", 10, "fake-key");
    expect(result).toEqual([]);
  });

  it("dedupes results that share a URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              { title: "A", url: "https://example.com/dup" },
              { title: "B (dup)", url: "https://example.com/dup" },
              { title: "C", url: "https://example.com/c" },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const result = await searchInvestmentNews("X", "X", 10, "fake-key");
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.title)).toEqual(["A", "C"]);
  });

  it("caps the result list at `count`", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: Array.from({ length: 20 }, (_, i) => ({
              title: `H${i}`,
              url: `https://example.com/${i}`,
            })),
          },
        }),
        { status: 200 },
      ),
    );
    const result = await searchInvestmentNews("X", "X", 5, "fake-key");
    expect(result).toHaveLength(5);
  });
});
