/**
 * Centralised passphrase validation.
 *
 * SQLCipher accepts the passphrase via `PRAGMA key = '...'` — a SQL
 * statement, not a parameterised query, because better-sqlite3 doesn't
 * expose a parameter-bound PRAGMA API for `key`. The caller escapes
 * single quotes (`replace(/'/g, "''")`) before interpolating, which
 * handles the conventional injection vector. But a passphrase
 * containing a literal newline / carriage-return / null byte would
 * still terminate the PRAGMA statement early, leaving whatever
 * follows the control character parseable as a fresh SQL fragment.
 * Practical impact is small (the next statement runs against an
 * encrypted DB with no key set, so it just errors out) but it's a
 * sharp edge worth blunting at the validation boundary.
 *
 * Rules enforced here:
 *   - Must be a string.
 *   - Length ≥ 1 (the unlock route gates on this too; redundant but
 *     keeps the validator self-contained).
 *   - No characters with code-point ≤ 0x1F or === 0x7F (DEL) — the
 *     control-character band. Tab (0x09) is excluded too; nobody
 *     intentionally wants their passphrase to contain a tab and it
 *     would only confuse copy-paste round trips.
 *
 * Returns null on success; a string error message on failure (suitable
 * for surfacing in the 400 response body).
 */
export function validatePassphrase(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return "Passphrase must be a string.";
  }
  if (raw.length === 0) {
    return "Passphrase must not be empty.";
  }
  for (let i = 0; i < raw.length; i++) {
    const cc = raw.charCodeAt(i);
    if (cc <= 0x1f || cc === 0x7f) {
      return "Passphrase contains a control character (newline / tab / etc.). Strip whitespace or paste-bombs before submitting.";
    }
  }
  return null;
}
