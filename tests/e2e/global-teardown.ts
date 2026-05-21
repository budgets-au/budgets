import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { MonkeyFinding } from "./_monkey-helpers";
import { type AppMap, GOAL_KEYS, loadAppMap } from "./_app-map";
import { classifyFindings } from "./_findings";

const VITEST_REPORT_PATH = resolve("./tests/e2e/.data/vitest-report.json");

/** After every Playwright run, fold the 1000-monkey findings into
 * TEST-RESULTS.md so the operator has one place to look. Replaces
 * the `<!-- monkey:start -->`/`<!-- monkey:end -->` block (creates
 * it if missing) — that keeps the section machine-overwritable
 * while everything else stays human-authored. Renamed from TODO.md
 * in 0.224.0 when the TODO file was retired (all open follow-up
 * work moved to GitHub Issues).
 *
 * No-op if no monkey crawl ran this session. */
export default async function globalTeardown(): Promise<void> {
  const reportPath = resolve("./tests/e2e/.data/monkey-report.json");
  const haveReport = existsSync(reportPath);
  let findings: MonkeyFinding[] = [];
  if (haveReport) {
    try {
      findings = JSON.parse(
        await readFile(reportPath, "utf8"),
      ) as MonkeyFinding[];
    } catch {
      findings = [];
    }
  }
  const map = await loadAppMap();
  // "Have map" if EITHER the breadth-first crawl populated
  // routes OR the goal-driven spec attempted a goal. Either
  // alone is enough signal to emit the expert-system section.
  const haveMap =
    Object.keys(map.routes).length > 0 ||
    Object.values(map.goals).some((g) => g.attempts > 0);
  if (!haveReport && !haveMap) return;

  const lines: string[] = [];

  // Run summary header.
  const { issues, questions, verified } = classifyFindings(findings);
  lines.push(
    `_Last run: ${new Date().toISOString()} · ${issues.length} issue${issues.length === 1 ? "" : "s"}, ${questions.length} question${questions.length === 1 ? "" : "s"}, ${verified.length} verified._`,
  );
  lines.push("");

  // Smart-monkey expert-system summary, if we have any map data.
  if (haveMap) {
    appendExpertSystem(lines, map);
    appendRunReport(lines, map);
  }

  // Vitest sidecar, if present. The report is written by the
  // `pnpm test:report` command; we render the latest one we find
  // (no recency cutoff — operators triage manually if it's stale).
  await appendVitestReport(lines);

  if (issues.length > 0) {
    lines.push("#### Issues");
    lines.push("");
    appendByPage(lines, issues);
  }
  if (questions.length > 0) {
    lines.push("#### Questions for review");
    lines.push("");
    lines.push(
      "_The crawl filled these forms and clicked their submit, but " +
        "saw no network call, toast, or navigation. Possibly a silent " +
        "no-op bug, possibly intentional — decide which._",
    );
    lines.push("");
    appendByPage(lines, questions);
  }
  if (verified.length > 0) {
    lines.push("#### Verified");
    lines.push("");
    lines.push(
      "_Goal verification legs that passed. Surfaced so the operator " +
        "can sanity-check what the monkey looked at, without mixing " +
        "into the silent-no-op questions above._",
    );
    lines.push("");
    appendByPage(lines, verified);
  }

  if (
    issues.length === 0 &&
    questions.length === 0 &&
    verified.length === 0 &&
    haveMap
  ) {
    lines.push(
      "_No issues, questions, or verifications on the last run — only the expert-system summary above._",
    );
    lines.push("");
  }

  await updateTodoBlock(lines.join("\n"));
}

/** Render the AppMap's coverage + goal state as a "Smart Monkey
 * expert system" subsection. Designed to be skimmable: one
 * goal-status table, one coverage line, one delta callout for
 * routes discovered but never deeply visited. */
function appendExpertSystem(lines: string[], map: AppMap): void {
  lines.push("#### Smart Monkey expert system");
  lines.push("");

  // Goal status table. Each row is read from the PERSISTED AppMap
  // (`tests/e2e/.data/app-map.json`) — rows accrue across runs so a
  // single-test run that only touches one goal doesn't blank the
  // achievement state of the others. The "Last attempt" column
  // makes that visible: a row whose `lastAttempt` is older than this
  // run's start was inherited from an earlier run, not re-verified
  // just now.
  lines.push("| Goal | Achieved | Last attempt | Attempts | Last successful run |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const key of GOAL_KEYS) {
    const g = map.goals[key];
    const recipe = g.successfulRun
      ? `${g.successfulRun.route} · "${g.successfulRun.triggerLabel}" → "${g.successfulRun.submitLabel}" (${g.successfulRun.verified})`
      : "_(not yet)_";
    // ISO date+minute is enough — second precision adds noise without
    // value, and the "Last attempt" column's job is "did this row
    // get re-checked recently or is it stale?".
    const stamp = g.lastAttempt ? g.lastAttempt.slice(0, 16).replace("T", " ") : "—";
    lines.push(
      `| \`${key}\` | ${g.achieved ? "✅" : "❌"} | ${stamp} | ${g.attempts} | ${recipe} |`,
    );
  }
  lines.push("");

  // Coverage line.
  const routeCount = Object.keys(map.routes).length;
  const controlCount = Object.values(map.routes).reduce(
    (n, r) => n + Object.keys(r.controls).length,
    0,
  );
  const linkCount = Object.values(map.routes).reduce(
    (n, r) => n + r.linksOut.length,
    0,
  );
  lines.push(
    `_Coverage: ${routeCount} route${routeCount === 1 ? "" : "s"} mapped, ` +
      `${controlCount} interactive control${controlCount === 1 ? "" : "s"} catalogued, ` +
      `${linkCount} in-app link${linkCount === 1 ? "" : "s"} discovered._`,
  );
  lines.push("");

  // Routes discovered but never visited deeply enough to harvest
  // controls — drill-down candidates for the next run.
  const drillTargets: string[] = [];
  for (const [path, route] of Object.entries(map.routes)) {
    if (route.visits > 0 && Object.keys(route.controls).length === 0) {
      drillTargets.push(path);
    }
  }
  if (drillTargets.length > 0) {
    lines.push(
      `_Drill-down candidates (${drillTargets.length}) — discovered but not yet exercised:_`,
    );
    for (const t of drillTargets.slice(0, 10)) {
      lines.push(`- \`${t}\``);
    }
    if (drillTargets.length > 10) {
      lines.push(`- _…and ${drillTargets.length - 10} more._`);
    }
    lines.push("");
  }
}

/** Render the latest run's granular counters + the list of
 * workflows the crawl has completed (achieved goals). Two
 * RunSummary rows can land per `pnpm test:e2e` invocation — one
 * from monkey.spec.ts (breadth-first + drill-down) and one from
 * monkey-goals.spec.ts (goal-driven). We sum them for the
 * "Latest run" totals so the operator sees the full picture
 * rather than half. */
function appendRunReport(lines: string[], map: AppMap): void {
  if (map.runs.length === 0) return;
  lines.push("#### Smart Monkey run report");
  lines.push("");

  // Both specs save a RunSummary per pnpm test:e2e invocation.
  // Walk back from the tail collecting rows that fell within
  // the last 5 minutes (one e2e cycle is ≤3 min); anything older
  // belongs to a previous run.
  const cutoffMs = Date.now() - 5 * 60_000;
  const recent = [...map.runs]
    .reverse()
    .filter((r) => Date.parse(r.ts) >= cutoffMs);
  if (recent.length === 0) {
    // Fall back to just the most recent row — better than
    // emitting an empty table.
    recent.push(map.runs[map.runs.length - 1]);
  }
  const sum = recent.reduce(
    (acc, r) => ({
      durationMs: acc.durationMs + r.durationMs,
      routesVisited: acc.routesVisited + r.routesVisited,
      buttonClicks: acc.buttonClicks + r.buttonClicks,
      switchToggles: acc.switchToggles + r.switchToggles,
      selectChanges: acc.selectChanges + r.selectChanges,
      textInputsFilled: acc.textInputsFilled + r.textInputsFilled,
      dialogsOpened: acc.dialogsOpened + r.dialogsOpened,
      formSubmits: acc.formSubmits + r.formSubmits,
      linksDiscovered: acc.linksDiscovered + r.linksDiscovered,
      consoleErrors: acc.consoleErrors + r.consoleErrors,
      goalsAttempted: acc.goalsAttempted + r.goalsAttempted,
      goalsAchieved: acc.goalsAchieved + r.goalsAchieved,
      findingsCount: acc.findingsCount + r.findingsCount,
    }),
    {
      durationMs: 0,
      routesVisited: 0,
      buttonClicks: 0,
      switchToggles: 0,
      selectChanges: 0,
      textInputsFilled: 0,
      dialogsOpened: 0,
      formSubmits: 0,
      linksDiscovered: 0,
      consoleErrors: 0,
      goalsAttempted: 0,
      goalsAchieved: 0,
      findingsCount: 0,
    },
  );
  const seconds = (sum.durationMs / 1000).toFixed(1);

  lines.push("| Metric | Count |");
  lines.push("| --- | --- |");
  lines.push(`| Total wall time | ${seconds}s |`);
  lines.push(`| Routes visited | ${sum.routesVisited} |`);
  lines.push(`| Button clicks | ${sum.buttonClicks} |`);
  lines.push(`| Switch toggles | ${sum.switchToggles} |`);
  lines.push(`| Select cycles | ${sum.selectChanges} |`);
  lines.push(`| Text inputs filled | ${sum.textInputsFilled} |`);
  lines.push(`| Dialogs opened | ${sum.dialogsOpened} |`);
  lines.push(`| Form submits | ${sum.formSubmits} |`);
  lines.push(`| Links discovered | ${sum.linksDiscovered} |`);
  lines.push(`| Console errors | ${sum.consoleErrors} |`);
  lines.push(`| Goals attempted | ${sum.goalsAttempted} |`);
  lines.push(`| Goals achieved | ${sum.goalsAchieved} |`);
  lines.push(`| Findings logged | ${sum.findingsCount} |`);
  lines.push("");

  // Workflows-completed list. A workflow is "completed" if the
  // smart monkey has EVER achieved it — `goals.<key>.achieved`
  // sticks once flipped. The recipe in `successfulRun` is the
  // proof; we surface its route + trigger + submit so the
  // operator can read the exact path.
  lines.push("##### Workflows completed");
  for (const key of GOAL_KEYS) {
    const g = map.goals[key];
    if (g.achieved && g.successfulRun) {
      const r = g.successfulRun;
      lines.push(
        `- ✅ \`${key}\` — \`${r.route}\` · click **${r.triggerLabel}** → fill → click **${r.submitLabel}** (verified via ${r.verified})`,
      );
    } else {
      lines.push(`- ❌ \`${key}\` — _(not yet completed)_`);
    }
  }
  lines.push("");
}

/** Vitest report sidecar — populated by `pnpm test:report`. The
 * shape we render here is whatever `scripts/vitest-summary.mjs`
 * boils the JSON reporter down to: pass/fail/skip counts,
 * suite totals, duration. Silent if no sidecar exists. */
interface VitestSummary {
  ts: string;
  totalFiles: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

async function appendVitestReport(lines: string[]): Promise<void> {
  if (!existsSync(VITEST_REPORT_PATH)) return;
  let summary: VitestSummary;
  try {
    summary = JSON.parse(
      await readFile(VITEST_REPORT_PATH, "utf8"),
    ) as VitestSummary;
  } catch {
    return;
  }
  lines.push("#### Vitest summary");
  lines.push("");
  lines.push(`_Last run: ${summary.ts}._`);
  lines.push("");
  const status = summary.failed === 0 ? "✅" : "🔴";
  lines.push(
    `${status} **${summary.passed} passed**` +
      (summary.failed > 0 ? `, ${summary.failed} failed` : "") +
      (summary.skipped > 0 ? `, ${summary.skipped} skipped` : "") +
      ` across ${summary.totalFiles} files (${(summary.durationMs / 1000).toFixed(1)}s).`,
  );
  lines.push("");
}

/** Render a list of findings grouped by page, with severity
 * emoji prefixes. Shared between the issues, questions, and
 * verified subsections so they read the same way. */
function appendByPage(lines: string[], findings: MonkeyFinding[]): void {
  const byPage = new Map<string, MonkeyFinding[]>();
  for (const f of findings) {
    const arr = byPage.get(f.page) ?? [];
    arr.push(f);
    byPage.set(f.page, arr);
  }
  for (const [page, list] of Array.from(byPage.entries()).sort()) {
    lines.push(`##### ${page}`);
    for (const f of list) {
      const tag =
        f.kind === "verified"
          ? "✅"
          : f.kind === "question"
            ? "❓"
            : f.severity === "error"
              ? "🔴"
              : f.severity === "warn"
                ? "🟡"
                : "🔵";
      const msg = f.message.replace(/\s+/g, " ").trim();
      lines.push(`- ${tag} **${f.action}** — ${msg}`);
    }
    lines.push("");
  }
}

async function updateTodoBlock(body: string): Promise<void> {
  // Renamed in 0.224.0: results moved from TODO.md → TEST-RESULTS.md
  // (TODO.md retired, all open work tracked in GitHub Issues). The
  // function name kept its `Todo` for now to avoid churn; the path
  // is what matters.
  const path = resolve("./TEST-RESULTS.md");
  if (!existsSync(path)) return;
  const current = await readFile(path, "utf8");
  const start = "<!-- monkey:start -->";
  const end = "<!-- monkey:end -->";
  const block = `${start}\n${body}\n${end}`;
  let next: string;
  if (current.includes(start) && current.includes(end)) {
    next = current.replace(
      new RegExp(`${start}[\\s\\S]*?${end}`),
      block,
    );
  } else {
    // Sentinels missing — append a fresh block at the end so the
    // next run has somewhere to replace into.
    next = `${current.trimEnd()}\n\n## Latest smart-monkey run\n\n${block}\n`;
  }
  await writeFile(path, next);
}
