#!/usr/bin/env node
/**
 * Extract the current version's section from CHANGELOG.md so the
 * Windows-CI release step can use it as the GitHub Release body.
 *
 * Reads `APP_VERSION` from `src/lib/version.ts`, finds the matching
 * `## X.Y.Z — DATE` heading in `CHANGELOG.md`, and prints everything
 * up to (but not including) the next `## ` heading.
 *
 * Run:
 *   node scripts/release-notes.mjs > release-body.md
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const versionFile = readFileSync(
  resolve(repoRoot, "src/lib/version.ts"),
  "utf8",
);
const versionMatch = versionFile.match(
  /APP_VERSION\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^"]*)?)"/,
);
if (!versionMatch) {
  console.error("✗ Couldn't parse APP_VERSION from src/lib/version.ts");
  process.exit(1);
}
const version = versionMatch[1];

const changelog = readFileSync(resolve(repoRoot, "CHANGELOG.md"), "utf8");

// Match `## <version> — <date>` (em-dash) and capture everything
// through the next `## ` heading or EOF.
const sectionRe = new RegExp(
  String.raw`(^|\n)##\s+${version.replace(/\./g, "\\.")}\b[^\n]*\n([\s\S]*?)(?=\n##\s|$)`,
);
const match = changelog.match(sectionRe);
if (!match) {
  console.error(`✗ No CHANGELOG.md entry found for version ${version}`);
  process.exit(1);
}

const body = match[2].trim();

// Prepend a short header so the release body reads cleanly out of
// context — GitHub renders this above the auto-collapsed commit
// list when `generate_release_notes` is also on.
const installLink =
  `**Windows installer:** [budgets-${version}-setup.exe](https://github.com/budgets-au/budgets/releases/download/v${version}/budgets-${version}-setup.exe) · ` +
  `**Linux container:** \`ghcr.io/budgets-au/budgets:${version}\``;

process.stdout.write(`${installLink}\n\n${body}\n`);
