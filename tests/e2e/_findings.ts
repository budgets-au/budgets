import type { MonkeyFinding } from "./_monkey-helpers";

/** Split findings into three buckets so the teardown report can
 * render each under its own heading. The classification is the
 * load-bearing detail — extracted into its own module so it can
 * be unit-tested under Vitest (the teardown hook itself imports
 * Playwright-adjacent state and isn't worth shimming). */
export function classifyFindings(findings: MonkeyFinding[]): {
  issues: MonkeyFinding[];
  questions: MonkeyFinding[];
  verified: MonkeyFinding[];
} {
  const issues: MonkeyFinding[] = [];
  const questions: MonkeyFinding[] = [];
  const verified: MonkeyFinding[] = [];
  for (const f of findings) {
    const kind = f.kind ?? "issue";
    if (kind === "question") questions.push(f);
    else if (kind === "verified") verified.push(f);
    else issues.push(f);
  }
  return { issues, questions, verified };
}
