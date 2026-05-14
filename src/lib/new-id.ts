/** UUID v4 generator that works in any context — secure or not.
 *
 * Why we don't just call `crypto.randomUUID()` directly: that API
 * requires a secure context (HTTPS or localhost). When the app is
 * served over plain HTTP from a non-localhost address (a LAN IP or
 * 0.0.0.0 in the dev environment), `crypto.randomUUID` throws a
 * silent TypeError mid-handler — taking down save flows that depend
 * on it (e.g. the saved-filters Save button, the chart-palette
 * editor's Add palette button) without surfacing as anything more
 * obvious than "the click did nothing."
 *
 * Strategy: prefer the native API where it works, fall through to
 * a Math.random-based polyfill that produces a syntactically valid
 * v4 UUID. The polyfill isn't cryptographically strong, but for
 * client-side row keys / preset ids that's not a security boundary
 * — the server treats every id as opaque user input anyway. */
export function newId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    try {
      return crypto.randomUUID();
    } catch {
      /* secure-context error — fall through to polyfill */
    }
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
    const n = Number(c);
    return (
      (n ^ (Math.floor(Math.random() * 16) >> (n / 4))) & 0xf
    ).toString(16);
  });
}
