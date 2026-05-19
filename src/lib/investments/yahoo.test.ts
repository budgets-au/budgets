import { describe, expect, it } from "vitest";
import { filterNewsItems } from "./yahoo";

type RawNewsItem = Parameters<typeof filterNewsItems>[0] extends
  | Array<infer T>
  | undefined
  ? T
  : never;

function raw(over: Partial<RawNewsItem> & { uuid: string; title: string }): RawNewsItem {
  return {
    uuid: over.uuid,
    title: over.title,
    publisher: over.publisher,
    link: over.link ?? `https://example.com/${over.uuid}`,
    providerPublishTime: over.providerPublishTime,
    thumbnail: over.thumbnail,
    relatedTickers: over.relatedTickers,
  };
}

describe("filterNewsItems", () => {
  it("tier-1 strict tag match wins; untagged generic items drop", () => {
    const items = [
      raw({
        uuid: "a",
        title: "CBA hits record",
        relatedTickers: ["CBA"],
      }),
      raw({
        uuid: "b",
        title: "Markets roundup",
        relatedTickers: ["XYZ"],
      }),
    ];
    const out = filterNewsItems(
      items,
      "CBA.AX",
      "Commonwealth Bank of Australia",
      20,
    );
    expect(out.map((i) => i.uuid)).toEqual(["a"]);
  });

  it("tier-2 rescues untagged item that mentions the company name in the title", () => {
    const items = [
      raw({
        uuid: "a",
        title: "Commonwealth Bank of Australia posts record profit",
        relatedTickers: undefined,
      }),
    ];
    const out = filterNewsItems(
      items,
      "CBA.AX",
      "Commonwealth Bank of Australia",
      20,
    );
    expect(out.map((i) => i.uuid)).toEqual(["a"]);
  });

  it("dedups by uuid, orders tier-1 before tier-2, caps at count, drops noise", () => {
    const items = [
      // tier-2 (no tags, bare-ticker title match)
      raw({
        uuid: "shares",
        title: "CBA shares jump on profit beat",
        relatedTickers: [],
      }),
      // tier-1 (strict tag)
      raw({
        uuid: "result",
        title: "Half-year result",
        relatedTickers: ["CBA.AX"],
      }),
      // noise — different ticker, unrelated to CBA
      raw({
        uuid: "noise",
        title: "ANZ profit dip",
        relatedTickers: ["ANZ.AX"],
      }),
      // duplicate of the tier-1 item arrives again as tier-2 (e.g.
      // surfaced via a syndication that drops the tag). Dedup
      // keeps a single copy in tier-1's slot.
      raw({
        uuid: "result",
        title: "Commonwealth Bank of Australia half-year result",
        relatedTickers: undefined,
      }),
    ];
    const out = filterNewsItems(
      items,
      "CBA.AX",
      "Commonwealth Bank of Australia",
      2,
    );
    expect(out.map((i) => i.uuid)).toEqual(["result", "shares"]);
  });

  it("ignores a 3-character or shorter companyName so it can't sweep every title", () => {
    const items = [
      raw({
        uuid: "a",
        title: "Markets quiet today",
        relatedTickers: undefined,
      }),
    ];
    // 1-letter company name (rare but real, e.g. AT&T's "T"
    // ticker on NYSE) shouldn't substring-match every headline.
    const out = filterNewsItems(items, "T", "T", 20);
    expect(out).toEqual([]);
  });

  it("strips Yahoo's exchange suffix from related-ticker tags before comparing", () => {
    // Yahoo sometimes drops .AX from its tags even when the user
    // searched for the suffixed form. The bare-ticker comparison
    // should still match.
    const items = [
      raw({
        uuid: "a",
        title: "BHP iron ore exports",
        relatedTickers: ["BHP"],
      }),
    ];
    const out = filterNewsItems(items, "BHP.AX", "BHP Group", 20);
    expect(out.map((i) => i.uuid)).toEqual(["a"]);
  });
});
