import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** A single finding from the 1000-monkeys exploratory crawl —
 * something that went wrong (or merits attention) while the test
 * was clicking the app. */
export interface MonkeyFinding {
  page: string;
  action: string;
  /** "error" — console error / page error / failed assertion. */
  severity: "error" | "warn" | "info";
  message: string;
  /** Optional stack snippet. */
  detail?: string;
}

const REPORT_PATH = resolve("./tests/e2e/.data/monkey-report.json");

/** Append a finding to the on-disk report (JSON). Called from
 * tests as they discover issues; the global teardown rolls the
 * report into TODO.md so the operator has one place to look. */
export async function recordFinding(f: MonkeyFinding): Promise<void> {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  let existing: MonkeyFinding[] = [];
  if (existsSync(REPORT_PATH)) {
    try {
      existing = JSON.parse(await readFile(REPORT_PATH, "utf8")) as MonkeyFinding[];
    } catch {
      existing = [];
    }
  }
  existing.push(f);
  await writeFile(REPORT_PATH, JSON.stringify(existing, null, 2));
}

/** Discard any prior crawl's findings. Called once per test run
 * in beforeAll so we don't accumulate stale data across runs. */
export async function clearFindings(): Promise<void> {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, "[]");
}

/** Read whatever the crawl recorded. The global teardown uses this
 * to roll findings into TODO.md. */
export async function readFindings(): Promise<MonkeyFinding[]> {
  if (!existsSync(REPORT_PATH)) return [];
  try {
    return JSON.parse(await readFile(REPORT_PATH, "utf8")) as MonkeyFinding[];
  } catch {
    return [];
  }
}

/** Aria labels / text patterns the crawl refuses to click. Any of
 * these would log the test session out or destroy data, ending
 * the run prematurely. Match is substring + case-insensitive. */
export const DESTRUCTIVE_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /sign\s*out/i,
  /log\s*out/i,
  /lock\s+database/i,
  /reset\s+browser\s+data/i,
  /delete/i,
  /remove/i,
  /archive/i,
  /clear/i,
  /^X$/, // close icons
  /change\s+database\s+passphrase/i,
  /rekey/i,
  /import/i, // navigates away to import flow
];

export function isDestructiveLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  return DESTRUCTIVE_TEXT_PATTERNS.some((re) => re.test(label));
}
