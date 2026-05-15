import type { Locator, Page, Request } from "@playwright/test";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** A single finding from the 1000-monkeys exploratory crawl —
 * something that went wrong (or merits attention) while the test
 * was clicking the app.
 *
 * `kind: "question"` is what the form-filling phase emits when a
 * submit produced no observable side-effect (no network call,
 * toast, nav, or error). The crawl can't tell if that's a real
 * bug or intentional — it asks the operator. */
export interface MonkeyFinding {
  page: string;
  action: string;
  /** "error" — console error / page error / failed assertion. */
  severity: "error" | "warn" | "info";
  message: string;
  /** Optional stack snippet. */
  detail?: string;
  /** "issue" (default) — something is wrong / needs investigation.
   * "question" — outcome was ambiguous; ask the operator. */
  kind?: "issue" | "question";
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

/** Noise the crawl gets fed by Playwright's own teardown — page
 * navigation cancels in-flight `/api/auth/session` requests,
 * NextAuth logs the abort as `Failed to fetch`. Not an app bug;
 * filter it. */
export const CONSOLE_NOISE_PATTERNS: ReadonlyArray<RegExp> = [
  /Failed to fetch.*errors\.authjs\.dev/i,
  /Failed to fetch.*\/api\/auth\/session/i,
  /Download the React DevTools/i,
  /Recharts.*The width\(.*\) and height\(.*\) of chart should be greater than 0/i,
];

export function isNoiseMessage(msg: string): boolean {
  return CONSOLE_NOISE_PATTERNS.some((re) => re.test(msg));
}

/* ──────────────────────────────────────────────────────────────
 * Form-filling phase
 *
 * The click-only crawl skips anything inside `<form>` or
 * `[data-slot="dialog-content"]` — so a save flow whose Save
 * button is a silent no-op on an empty form (the 0.46.x
 * saved-filters bug) never gets exercised. The helpers below let
 * the crawl fill plausible defaults into every visible input,
 * submit, and watch for an observable outcome. Submits that
 * produce nothing visible get logged as `kind: "question"` —
 * possibly intentional, possibly a bug, the operator decides.
 * ────────────────────────────────────────────────────────────── */

/** Outcome of a form submission, in priority order: a real
 * outcome means the submit DID something. "silent" means the
 * crawl saw no side-effect within the observation window — the
 * thing the operator probably wants to know about. */
export type FormOutcome =
  | { kind: "network"; method: string; url: string; status: number }
  | { kind: "toast"; text: string }
  | { kind: "nav"; to: string }
  | { kind: "error"; message: string }
  | { kind: "silent" };

const OBSERVE_WINDOW_MS = 800;

/** Fill a single input with a safe default keyed by its type.
 * Returns true if the input was filled. `password` inputs are
 * never touched — the auth flow already covers them and a typo
 * here could lock the test user out of subsequent specs. */
export async function fillInputSafely(input: Locator): Promise<boolean> {
  if (!(await input.isVisible().catch(() => false))) return false;
  if (!(await input.isEnabled().catch(() => false))) return false;
  if (await input.evaluate((el) =>
    (el as HTMLInputElement).readOnly === true ||
    (el as HTMLInputElement).disabled === true,
  ).catch(() => false)) {
    return false;
  }
  const tag = await input.evaluate((el) => el.tagName).catch(() => "");
  if (tag === "TEXTAREA") {
    await input.fill("monkey-test").catch(() => {});
    return true;
  }
  if (tag === "SELECT") {
    const opts = await input.locator("option").count().catch(() => 0);
    if (opts < 2) return false;
    // Pick the second option — first is often a placeholder /
    // current value, second is "the next thing" the user might
    // try. selectOption({ index: 1 }) is safer than guessing.
    await input.selectOption({ index: 1 }).catch(() => {});
    return true;
  }
  const type = (await input.getAttribute("type").catch(() => null)) ?? "text";
  switch (type) {
    case "text":
    case "search":
    case "tel":
    case "url":
      await input.fill("monkey-test").catch(() => {});
      return true;
    case "email":
      await input.fill("monkey@test.local").catch(() => {});
      return true;
    case "number":
      await input.fill("42").catch(() => {});
      return true;
    case "date":
      await input.fill("2026-01-01").catch(() => {});
      return true;
    case "datetime-local":
      await input.fill("2026-01-01T12:00").catch(() => {});
      return true;
    case "checkbox":
      await input.click().catch(() => {});
      return true;
    case "password":
    case "hidden":
    case "file":
    case "submit":
    case "button":
      return false;
    default:
      // Conservative: unknown input types stay untouched.
      return false;
  }
}

/** Watch a page for an observable side-effect after the next
 * submit-shaped click. Listeners are wired BEFORE the click and
 * disposed after the observation window closes. */
export async function observeSubmitOutcome(
  page: Page,
  doSubmit: () => Promise<void>,
): Promise<FormOutcome> {
  const startUrl = page.url();
  const networkHits: FormOutcome[] = [];
  const consoleErrs: string[] = [];

  const reqListener = (req: Request) => {
    const method = req.method().toUpperCase();
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) return;
    // Capture the request; status comes from the response.
    req
      .response()
      .then((resp) => {
        if (!resp) return;
        networkHits.push({
          kind: "network",
          method,
          url: req.url(),
          status: resp.status(),
        });
      })
      .catch(() => {});
  };
  const consoleListener = (msg: { type(): string; text(): string }) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isNoiseMessage(text)) return;
    consoleErrs.push(text);
  };

  page.on("request", reqListener);
  page.on("console", consoleListener);

  try {
    await doSubmit();
  } finally {
    // Window for outcomes to materialise. Short enough to not
    // dominate the per-page budget; long enough for a typical
    // POST + toast render.
    await page.waitForTimeout(OBSERVE_WINDOW_MS).catch(() => {});
  }
  page.off("request", reqListener);
  page.off("console", consoleListener);

  // Toast check (sonner mounts `[data-sonner-toast]`).
  const toastText = await page
    .locator("[data-sonner-toast]")
    .first()
    .textContent({ timeout: 100 })
    .catch(() => null);

  const endUrl = page.url();
  const navigated = endUrl !== startUrl;

  // Priority: error > network > toast > nav > silent. A 5xx
  // network or a console error is the most useful signal.
  const erroredNetwork = networkHits.find((h) =>
    h.kind === "network" ? h.status >= 500 : false,
  );
  if (erroredNetwork) return erroredNetwork;
  if (consoleErrs.length > 0) {
    return { kind: "error", message: consoleErrs[0] };
  }
  if (networkHits.length > 0) return networkHits[0];
  if (toastText && toastText.trim().length > 0) {
    return { kind: "toast", text: toastText.trim() };
  }
  if (navigated) return { kind: "nav", to: endUrl };
  return { kind: "silent" };
}

/** Pick the submit-shaped button for a form/dialog. Prefers an
 * explicit `[type="submit"]`, then a button labelled Save / Add
 * / Create / Apply / OK. Returns null if no plausible submit is
 * visible, or if the only submit looks destructive (we don't
 * want to fire Delete on a half-filled form). */
export async function findSubmitButton(
  container: Locator,
): Promise<Locator | null> {
  const submitTyped = container.locator('button[type="submit"]:visible');
  if ((await submitTyped.count()) > 0) {
    const first = submitTyped.first();
    const label = (await first.textContent().catch(() => null)) ?? "";
    if (isDestructiveLabel(label)) return null;
    return first;
  }
  const labelRe = /^\s*(save|add|create|apply|ok|done)\b/i;
  const buttons = container.locator("button:visible");
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const b = buttons.nth(i);
    const txt = (await b.textContent().catch(() => null))?.trim() ?? "";
    if (!labelRe.test(txt)) continue;
    if (isDestructiveLabel(txt)) continue;
    return b;
  }
  return null;
}

/** Render a `FormOutcome` into the message text used in the
 * recorded finding. Kept here so the spec stays a thin
 * orchestrator. */
export function describeOutcome(outcome: FormOutcome): string {
  switch (outcome.kind) {
    case "network":
      return `${outcome.method} ${outcome.url} → ${outcome.status}`;
    case "toast":
      return `toast: ${outcome.text}`;
    case "nav":
      return `navigated to ${outcome.to}`;
    case "error":
      return `console error: ${outcome.message}`;
    case "silent":
      return "no network call, toast, or navigation fired";
  }
}
