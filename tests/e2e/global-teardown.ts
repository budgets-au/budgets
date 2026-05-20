import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { MonkeyFinding } from "./_monkey-helpers";
import { type AppMap, GOAL_KEYS, loadAppMap } from "./_app-map";

/** After every Playwright run, fold the 1000-monkey findings into
 * TODO.md so the operator has one place to look. Replaces the
 * `<!-- monkey:start -->`/`<!-- monkey:end -->` block in TODO.md
 * (creates it if missing) — that keeps the section
 * machine-overwritable while everything else stays human-authored.
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
  const issues = findings.filter((f) => (f.kind ?? "issue") !== "question");
  const questions = findings.filter((f) => f.kind === "question");
  lines.push(
    `_Last run: ${new Date().toISOString()} · ${issues.length} issue${issues.length === 1 ? "" : "s"}, ${questions.length} question${questions.length === 1 ? "" : "s"}._`,
  );
  lines.push("");

  // Smart-monkey expert-system summary, if we have any map data.
  if (haveMap) {
    appendExpertSystem(lines, map);
  }

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

  if (issues.length === 0 && questions.length === 0 && haveMap) {
    lines.push(
      "_No issues or questions on the last run — only the expert-system summary above._",
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

  // Goal status table.
  lines.push("| Goal | Achieved | Attempts | Last successful run |");
  lines.push("| --- | --- | --- | --- |");
  for (const key of GOAL_KEYS) {
    const g = map.goals[key];
    const recipe = g.successfulRun
      ? `${g.successfulRun.route} · "${g.successfulRun.triggerLabel}" → "${g.successfulRun.submitLabel}" (${g.successfulRun.verified})`
      : "_(not yet)_";
    lines.push(
      `| \`${key}\` | ${g.achieved ? "✅" : "❌"} | ${g.attempts} | ${recipe} |`,
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

/** Render a list of findings grouped by page, with severity
 * emoji prefixes. Shared between the issues and questions
 * subsections so they read the same way. */
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
        f.kind === "question"
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
  const todoPath = resolve("./TODO.md");
  if (!existsSync(todoPath)) return;
  const current = await readFile(todoPath, "utf8");
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
    // Insert at the top of the "Known bugs" section if present,
    // otherwise append.
    const header = "## Known bugs / regressions to investigate";
    if (current.includes(header)) {
      next = current.replace(
        header,
        `${header}\n\n### 1000-monkeys crawl findings\n\n${block}`,
      );
    } else {
      next = `${current.trimEnd()}\n\n## 1000-monkeys crawl findings\n\n${block}\n`;
    }
  }
  await writeFile(todoPath, next);
}
