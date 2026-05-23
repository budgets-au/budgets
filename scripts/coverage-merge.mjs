#!/usr/bin/env node

/** Merge unit + e2e Istanbul coverage maps into a combined report.
 *
 *  Inputs (each optional — skipped if missing):
 *   - `.coverage/unit/coverage-final.json` (vitest)
 *   - `.coverage/e2e/coverage-final.json`  (c8 over the playwright V8 dump)
 *
 *  Outputs:
 *   - Combined HTML at `.coverage/report/index.html`
 *   - Combined JSON at `.coverage/report/coverage-final.json`
 *   - Text + text-summary streamed to stdout
 *
 *  The merge is per-file, additive on statement / branch / function
 *  hit counts. `istanbul-lib-coverage`'s `CoverageMap.merge()` does the
 *  arithmetic — we just plumb both inputs into the same map. */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";

const ROOT = process.cwd();
const SOURCES = [
  resolve(ROOT, ".coverage/unit/coverage-final.json"),
  resolve(ROOT, ".coverage/e2e/coverage-final.json"),
];
const OUT_DIR = resolve(ROOT, ".coverage/report");

mkdirSync(OUT_DIR, { recursive: true });

const merged = libCoverage.createCoverageMap();
let sourcesUsed = 0;
for (const path of SOURCES) {
  if (!existsSync(path)) {
    console.warn(`▷ skipping (not present): ${path}`);
    continue;
  }
  const data = JSON.parse(readFileSync(path, "utf8"));
  const fileCount = Object.keys(data).length;
  if (fileCount === 0) {
    console.warn(
      `▷ ${path} has 0 files — the upstream collector wrote an ` +
        `empty Istanbul map. Most common cause for the e2e leg: Next 16 ` +
        `Turbopack ships empty source maps (\`sources:[]\`) in both dev ` +
        `and prod, so c8 can't remap V8 dumps back to src/**. The unit ` +
        `coverage still merges; the combined % reflects the unit layer only.`,
    );
    continue;
  }
  merged.merge(data);
  sourcesUsed += 1;
  console.log(`▶ merged: ${path} (${fileCount} files)`);
}

if (sourcesUsed === 0) {
  console.error(
    "✗ No coverage inputs found. Run `pnpm coverage:unit` and/or " +
      "`pnpm coverage:e2e && pnpm coverage:e2e-report` first.",
  );
  process.exit(1);
}

const context = libReport.createContext({
  dir: OUT_DIR,
  coverageMap: merged,
  defaultSummarizer: "nested",
});

reports.create("text", { skipFull: false }).execute(context);
reports.create("text-summary").execute(context);
reports.create("html").execute(context);
reports.create("json", { file: "coverage-final.json" }).execute(context);

console.log(`\n📊 Combined report: ${resolve(OUT_DIR, "index.html")}`);
