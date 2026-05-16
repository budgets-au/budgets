#!/usr/bin/env node
/**
 * Thin wrapper for `electron-builder --win` that injects
 * `APP_VERSION` (from `src/lib/version.ts`) as the artifact
 * version. `package.json`'s `version` field is pinned at 0.9.0
 * for Docker-layer caching, so electron-builder's default
 * `${version}` interpolation would name the installer
 * `budgets-0.9.0-setup.exe` — wrong, and the release-notes
 * download link would 404.
 *
 * Run via `pnpm electron:build:win`, which chains
 * `electron:rebuild → electron:prepare → this script`.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const versionFile = readFileSync(
  resolve(repoRoot, "src/lib/version.ts"),
  "utf8",
);
const m = versionFile.match(
  /APP_VERSION\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^"]*)?)"/,
);
if (!m) {
  console.error("✗ Couldn't parse APP_VERSION from src/lib/version.ts");
  process.exit(1);
}
const version = m[1];
console.log(`▶ Building Windows installer for APP_VERSION=${version}`);

const res = spawnSync(
  "pnpm",
  [
    "exec",
    "electron-builder",
    "--win",
    "--x64",
    "--config",
    "electron-builder.yml",
    `--config.extraMetadata.version=${version}`,
    "--publish=never",
  ],
  { stdio: "inherit", cwd: repoRoot },
);
process.exit(res.status ?? 1);
