import { describe, expect, it } from "vitest";
import { parseNextLink } from "./parse-next-link";

describe("parseNextLink", () => {
  it("returns null for an absent header", () => {
    expect(parseNextLink(null)).toBe(null);
  });

  it("returns null when the header has no rel=next entry", () => {
    expect(
      parseNextLink('</v2/x/tags/list?last=0.1.0>; rel="prev"'),
    ).toBe(null);
  });

  it("resolves a relative path against the GHCR base", () => {
    expect(
      parseNextLink(
        '</v2/budgets-au/budgets/tags/list?last=0.146.0&n=100>; rel="next"',
      ),
    ).toBe(
      "https://ghcr.io/v2/budgets-au/budgets/tags/list?last=0.146.0&n=100",
    );
  });

  it("keeps an absolute URL as-is", () => {
    expect(
      parseNextLink(
        '<https://ghcr.io/v2/x/tags/list?last=0.1.0>; rel="next"',
      ),
    ).toBe("https://ghcr.io/v2/x/tags/list?last=0.1.0");
  });

  it("picks rel=next out of a comma-separated header", () => {
    expect(
      parseNextLink(
        '</v2/x/tags/list?last=A>; rel="prev", </v2/x/tags/list?last=Z>; rel="next"',
      ),
    ).toBe("https://ghcr.io/v2/x/tags/list?last=Z");
  });

  it("accepts unquoted rel values", () => {
    expect(parseNextLink("</v2/x/tags/list?last=A>; rel=next")).toBe(
      "https://ghcr.io/v2/x/tags/list?last=A",
    );
  });
});
