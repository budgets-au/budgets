/** Extracts the next-page URL from a Docker-registry `Link`
 *  header. Format per RFC 5988:
 *    `<relative-or-absolute-url>; rel="next"`
 *  Multiple links can be comma-separated; only the `rel="next"`
 *  entry matters. Relative URLs resolve against the GHCR base. */
export function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) {
      const path = m[1].trim();
      return path.startsWith("http") ? path : `https://ghcr.io${path}`;
    }
  }
  return null;
}
