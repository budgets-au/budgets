#!/usr/bin/env node
/**
 * Boil Vitest's JSON reporter output down to the handful of fields
 * the smart-monkey TODO.md run report renders. Reads
 * `tests/e2e/.data/vitest-report-raw.json` (the `--outputFile` of
 * `vitest run --reporter=json`) and writes
 * `tests/e2e/.data/vitest-report.json` in the shape the Playwright
 * teardown expects.
 *
 * The raw Vitest reporter dumps every assertion of every test —
 * megabytes of JSON we don't need for a per-run summary. This
 * boil-down step keeps the on-disk sidecar small (single-digit KB)
 * so the teardown doesn't have to walk a huge AST every e2e run.
 *
 * Invoked as the second half of `pnpm test` (chained via &&) so the
 * TEST-RESULTS.md "Vitest summary" block — which the Playwright
 * teardown writes from this script's output — stays in sync with
 * the most recent passing test run. `pnpm test:report` is kept as
 * an alias for backwards compat.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const RAW = resolve("./tests/e2e/.data/vitest-report-raw.json");
const OUT = resolve("./tests/e2e/.data/vitest-report.json");

if (!existsSync(RAW)) {
  console.error(`vitest-summary: no raw report at ${RAW}`);
  process.exit(0);
}

const raw = JSON.parse(readFileSync(RAW, "utf8"));

// Vitest's JSON reporter shape:
//   { testResults: [{ assertionResults: [...], status }], numTotalTests, ... }
// The roll-up fields we want are mostly already at the top level.
const summary = {
  ts: new Date().toISOString(),
  totalFiles: Array.isArray(raw.testResults) ? raw.testResults.length : 0,
  totalTests: raw.numTotalTests ?? 0,
  passed: raw.numPassedTests ?? 0,
  failed: raw.numFailedTests ?? 0,
  skipped: (raw.numPendingTests ?? 0) + (raw.numTodoTests ?? 0),
  // Vitest's JSON reporter exposes startTime but not endTime, so
  // fall back to now() − startTime. Close enough for a report
  // that runs immediately after the suite.
  durationMs:
    typeof raw.startTime === "number"
      ? Math.max(0, Date.now() - raw.startTime)
      : raw.duration ?? 0,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(
  `vitest-summary: ${summary.passed}/${summary.totalTests} passed, ` +
    `${summary.failed} failed → ${OUT}`,
);
