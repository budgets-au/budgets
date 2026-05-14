import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { MonkeyFinding } from "./_monkey-helpers";

/** After every Playwright run, fold the 1000-monkey findings into
 * TODO.md so the operator has one place to look. Replaces the
 * `<!-- monkey:start -->`/`<!-- monkey:end -->` block in TODO.md
 * (creates it if missing) — that keeps the section
 * machine-overwritable while everything else stays human-authored.
 *
 * No-op if no monkey crawl ran this session. */
export default async function globalTeardown(): Promise<void> {
  const reportPath = resolve("./tests/e2e/.data/monkey-report.json");
  if (!existsSync(reportPath)) return;
  let findings: MonkeyFinding[];
  try {
    findings = JSON.parse(await readFile(reportPath, "utf8")) as MonkeyFinding[];
  } catch {
    return;
  }
  if (findings.length === 0) {
    // Still rewrite the block so a fresh "no findings" run clears
    // stale entries.
    await updateTodoBlock("_No monkey-crawl findings on the last run._");
    return;
  }

  // Group by page → action so the report reads tidily.
  const byPage = new Map<string, MonkeyFinding[]>();
  for (const f of findings) {
    const arr = byPage.get(f.page) ?? [];
    arr.push(f);
    byPage.set(f.page, arr);
  }
  const lines: string[] = [];
  lines.push(
    `_Last run: ${new Date().toISOString()} · ${findings.length} finding${findings.length === 1 ? "" : "s"}._`,
  );
  lines.push("");
  for (const [page, list] of Array.from(byPage.entries()).sort()) {
    lines.push(`### ${page}`);
    for (const f of list) {
      const tag =
        f.severity === "error" ? "🔴" : f.severity === "warn" ? "🟡" : "🔵";
      const msg = f.message.replace(/\s+/g, " ").trim();
      lines.push(`- ${tag} **${f.action}** — ${msg}`);
    }
    lines.push("");
  }
  await updateTodoBlock(lines.join("\n"));
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
