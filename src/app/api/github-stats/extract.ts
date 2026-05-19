/** Pure HTML extractors for the GHCR package page. Public,
 *  no auth — we scrape two numbers the page renders in plain
 *  HTML:
 *    - "Total downloads" beside an `<h3 title="N">N</h3>`.
 *    - The header stars counter, a
 *      `<span id="repo-stars-counter-star" ... title="N">N</span>`.
 *  Either can return null on a layout change; the widget
 *  falls back to "—" per stat. */

const DOWNLOADS_RE =
  /Total downloads<\/span>\s*<h3\s+title="(\d+)"/i;

const STARS_RE =
  /id="repo-stars-counter-star"[^>]*title="(\d+)"/i;

function parseNumber(match: RegExpExecArray | null): number | null {
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function extractGithubStats(html: string): {
  downloads: number | null;
  stars: number | null;
} {
  return {
    downloads: parseNumber(DOWNLOADS_RE.exec(html)),
    stars: parseNumber(STARS_RE.exec(html)),
  };
}
