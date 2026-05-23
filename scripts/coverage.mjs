#!/usr/bin/env node

/** End-to-end coverage runner.
 *
 *  Two collectors:
 *   1. vitest (`coverage:unit`) — uses @vitest/coverage-v8 which
 *      hooks into the Vite transform pipeline (raw V8 dumps from
 *      vitest workers don't carry src/* URLs, so the hook is
 *      mandatory). Emits Istanbul JSON to `.coverage/unit/`.
 *   2. playwright (`coverage:e2e`) — boots the Next.js server with
 *      NODE_V8_COVERAGE=.coverage/e2e/raw/ and drives the suite.
 *      A second pass (`coverage:e2e-report`) runs c8 over the raw
 *      V8 dump, source-mapping back to src/* and writing Istanbul
 *      JSON to `.coverage/e2e/`.
 *
 *  Then `coverage:report` merges both Istanbul maps into a single
 *  text + HTML report under `.coverage/report/`.
 *
 *  Skip the e2e leg via `--no-e2e` when iterating on unit tests
 *  (it's the slow part — 3-5 minutes for the build + full crawl). */

import { rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const REPORT_DIR = ".coverage/report";
// e2e leg is OFF by default because Next 16 Turbopack ships empty
// source maps (`sources:[]`) in both dev and prod modes — c8 then
// can't remap the V8-dump URLs back to `src/**`, so the e2e leg
// contributes 0 files to the merge and burns ~16 minutes for nothing.
// Opt in via `pnpm coverage --with-e2e` once upstream Turbopack
// fixes source maps (or you've patched the build to use webpack).
const skipE2E = !process.argv.includes("--with-e2e");
const skipUnit = process.argv.includes("--no-unit");

function run(label, cmd, args, { tolerateFailure = false } = {}) {
  console.log(`\n▶ ${label}: ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    if (tolerateFailure) {
      console.warn(
        `⚠ ${label} exited ${result.status} — continuing so the ` +
          `collected V8 dump still gets merged into the report.`,
      );
      return;
    }
    console.error(`✗ ${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

// Fresh slate. Stale Istanbul JSONs from a previous run would
// be re-merged by the report step and inflate the numbers.
rmSync(".coverage", { recursive: true, force: true });
mkdirSync(".coverage/e2e/raw", { recursive: true });

// Wipe `.next-e2e/` when running the e2e leg so `next build` regen
// the bundle with `productionBrowserSourceMaps` + `serverSourceMaps`
// enabled (next.config.ts gates both on COLLECT_COVERAGE=1, and the
// build is otherwise incremental — stale empty source maps from a
// previous non-coverage build would leave c8 with nothing to map).
if (!skipE2E) {
  rmSync(".next-e2e", { recursive: true, force: true });
}

if (!skipUnit) {
  run("unit (vitest)", "pnpm", ["coverage:unit"]);
}
if (!skipE2E) {
  // Tolerate per-spec failures: a slow timeout under V8 instrumentation
  // overhead is signal worth investigating, but the coverage data
  // from the routes that DID exercise is still valuable. The merge
  // step's report will name what was covered; CI can flag the actual
  // test failures separately.
  run("e2e (playwright)", "pnpm", ["coverage:e2e"], {
    tolerateFailure: true,
  });
  run("e2e translate (c8)", "pnpm", ["coverage:e2e-report"]);
}
run("merge + report", "pnpm", ["coverage:report"]);

console.log(`\n📊 Combined report: ${join(REPORT_DIR, "index.html")}`);
