import { describe, expect, it } from "vitest";
import { extractGithubStats } from "./extract";

const DOWNLOADS_BLOCK = `
  <div>
    <span class="d-block color-fg-muted text-small tmp-mb-1">Total downloads</span>
    <h3 title="71">71</h3>
  </div>
`;

const STARS_BLOCK = `
  <a href="/budgets-au/budgets/stargazers">
    Star
    <span id="repo-stars-counter-star" aria-label="2 users starred this repository" data-singular-suffix="user starred this repository" title="2" class="Counter">2</span>
  </a>
`;

describe("extractGithubStats", () => {
  it("happy path — both numbers present", () => {
    const html = `<html><body>${STARS_BLOCK}${DOWNLOADS_BLOCK}</body></html>`;
    expect(extractGithubStats(html)).toEqual({ downloads: 71, stars: 2 });
  });

  it("partial — stars only, downloads block absent", () => {
    const html = `<html><body>${STARS_BLOCK}</body></html>`;
    expect(extractGithubStats(html)).toEqual({ downloads: null, stars: 2 });
  });

  it("neither present (page markup changed entirely)", () => {
    const html = "<html><body><p>nothing here</p></body></html>";
    expect(extractGithubStats(html)).toEqual({
      downloads: null,
      stars: null,
    });
  });

  it("malformed title attribute returns null for that field", () => {
    // Stars span exists but `title=""` — regex requires \d+ so
    // the field falls back to null while downloads still parses.
    const html = `
      <span id="repo-stars-counter-star" title="" class="Counter"></span>
      ${DOWNLOADS_BLOCK}
    `;
    expect(extractGithubStats(html)).toEqual({
      downloads: 71,
      stars: null,
    });
  });
});
