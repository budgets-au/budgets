/** Single source of truth for the app's release version. Lives as a
 * standalone literal so the Docker layer that copies package.json
 * for `npm ci` survives version bumps — package.json's `version`
 * field is no longer the canonical pointer.
 *
 * Release flow:
 *   1. Edit APP_VERSION below.
 *   2. Append a section to CHANGELOG.md.
 *   3. Commit + `npm run docker:release`. The release script reads
 *      this constant via simple regex and tags the image with it.
 *
 * Keep the format as a JS string literal (double-quoted) on a single
 * line so the regex in scripts/docker-release.mjs stays simple. */
export const APP_VERSION = "0.212.0";
