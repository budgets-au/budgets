import type { Locator, Page, Request } from "@playwright/test";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type AppMap,
  type ControlKind,
  isInternalPath,
  recordControl as recordControlInMap,
  recordLink as recordLinkInMap,
} from "./_app-map";

/** A single finding from the 1000-monkeys exploratory crawl —
 * something that went wrong (or merits attention) while the test
 * was clicking the app.
 *
 * `kind: "question"` is what the form-filling phase emits when a
 * submit produced no observable side-effect (no network call,
 * toast, nav, or error). The crawl can't tell if that's a real
 * bug or intentional — it asks the operator.
 *
 * `kind: "verified"` is what monkey-goals.spec.ts emits when a
 * verification leg PASSED. We still log the message (so the
 * operator can sanity-check what the monkey checked), but the
 * teardown renders them under a separate "Verified" heading
 * rather than mixing them in with the "silent no-op" questions. */
export interface MonkeyFinding {
  page: string;
  action: string;
  /** "error" — console error / page error / failed assertion. */
  severity: "error" | "warn" | "info";
  message: string;
  /** Optional stack snippet. */
  detail?: string;
  /** "issue" (default) — something is wrong / needs investigation.
   * "question" — outcome was ambiguous; ask the operator.
   * "verified" — a positive verification (goal leg passed). */
  kind?: "issue" | "question" | "verified";
}

const REPORT_PATH = resolve("./tests/e2e/.data/monkey-report.json");

/** Append a finding to the on-disk report (JSON). Called from
 * tests as they discover issues; the global teardown rolls the
 * report into TEST-RESULTS.md so the operator has one place to look. */
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
 * to roll findings into TEST-RESULTS.md. */
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
 * thing the operator probably wants to know about.
 *
 * `persisted` on the network variant distinguishes "the route
 * returned an identifiable row" (POST → `{id:"<uuid>", ...}` or a
 * non-empty array of rows) from "the route returned 200 but no
 * proof of persistence" (e.g. `{ok:true}` only, empty body, or a
 * 2xx with a body that doesn't look row-shaped). The caller flags
 * the latter case for review — a regression that has the route
 * stop persisting while still answering 200 reads as green
 * otherwise. Always true for DELETE / PATCH / non-row-returning
 * actions: see `looksPersisted` for the heuristic. */
export type FormOutcome =
  | {
      kind: "network";
      method: string;
      url: string;
      status: number;
      body?: string;
      persisted: boolean;
    }
  | { kind: "toast"; text: string }
  | { kind: "nav"; to: string }
  | { kind: "error"; message: string }
  | { kind: "silent" };

/** Inspect a captured response body string and decide whether it
 * looks like the server actually persisted a row. The heuristic is
 * intentionally permissive — a regression that has the route stop
 * persisting while still answering `{ok:true}` is what we're
 * pinning against, NOT every route that doesn't echo a row.
 *
 * Returns `true` when the parsed body has shape suggesting a real
 * resource was returned:
 *   - `{ id: "<uuid-like>", ... }` (top-level id) — a created row.
 *   - `[ {...}, ... ]` (non-empty array) — list of rows returned.
 *   - `{ data: {...} }` / `{ row: {...} }` — common envelope shapes.
 *
 * Returns `false` for:
 *   - empty / unparseable body
 *   - `{}`, `null`
 *   - `{ ok: true }` ONLY (no id, no rows, no envelope)
 *   - `{ updated: N }` / `{ count: N }` — bulk results, no row proof.
 *     (These ARE legitimate routes; the caller can choose to permit
 *     them via the `methodAllowsBareOk` second pass — bulk routes
 *     are intended-to-be-bare and not a regression target.) */
export function looksPersisted(body: string | undefined): boolean {
  if (!body) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (parsed === null) return false;
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  // Top-level id is the canonical row marker.
  if (typeof obj.id === "string" && obj.id.length > 0) return true;
  // Common envelope shapes — recurse one level.
  for (const key of ["data", "row", "entry"]) {
    const inner = obj[key];
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      typeof (inner as Record<string, unknown>).id === "string"
    ) {
      return true;
    }
    if (Array.isArray(inner) && inner.length > 0) return true;
  }
  return false;
}

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
    // Capture the request; status comes from the response. For
    // 4xx/5xx we also pull the response body (capped) so the
    // operator can see WHY the server rejected without having
    // to instrument the route by hand. For 2xx we also peek at
    // the body so we can stamp `persisted` — a route that returns
    // `{ok:true}` without actually creating a row should NOT read
    // as healthy (the regression shape we're pinning against).
    req
      .response()
      .then(async (resp) => {
        if (!resp) return;
        const status = resp.status();
        const rawBody = (await resp.text().catch(() => "")).slice(0, 512);
        const isCreateLike = method === "POST" || method === "PUT";
        // PATCH/DELETE bodies vary by route — they're not expected
        // to return a single created row. Don't downgrade them on
        // the `persisted` check. Only POST/PUT (the create paths)
        // are held to "must show row evidence".
        const persisted = !isCreateLike || looksPersisted(rawBody);
        networkHits.push({
          kind: "network",
          method,
          url: req.url(),
          status,
          // Capture the body for 4xx/5xx (the existing operator
          // signal) AND for 2xx-but-not-persisted (the new
          // signal). Healthy 2xx with persistence proof stays
          // body-less so the report doesn't bloat.
          body:
            status >= 400 || !persisted ? rawBody.slice(0, 240) : undefined,
          persisted,
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

/* ──────────────────────────────────────────────────────────────
 * Smart-monkey: harvest the page into the AppMap
 *
 * These helpers walk a Playwright `Page` and feed observations
 * into the in-memory AppMap. Kept here (next to the rest of the
 * Playwright-coupled helpers) rather than in `_app-map.ts` so the
 * pure-logic module stays Vitest-testable.
 * ────────────────────────────────────────────────────────────── */

/** Snapshot the in-app links visible on `page` and merge them
 * into the map's linksOut for `path`. Returns the new (not
 * previously known) destinations so the caller can decide which
 * to drill into. */
export async function harvestLinks(
  page: Page,
  map: AppMap,
  path: string,
): Promise<string[]> {
  const hrefs = await page
    .locator('a[href]:visible')
    .evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""),
    )
    .catch(() => [] as string[]);
  const seen = new Set(map.routes[path]?.linksOut ?? []);
  const fresh: string[] = [];
  for (const h of hrefs) {
    const cleaned = h.split("#")[0].split("?")[0];
    if (!isInternalPath(cleaned)) continue;
    if (cleaned === path) continue;
    recordLinkInMap(map, path, cleaned);
    if (!seen.has(cleaned)) fresh.push(cleaned);
  }
  return fresh;
}

/** Inventory every visible button / switch / select on `page`,
 * recording the kind + accessible label into the map. Does NOT
 * click anything — this is the dry sweep that fills in the
 * control catalogue. The poke phase in the spec calls
 * `recordControl` separately when it actually exercises each
 * affordance. */
export async function harvestControls(
  page: Page,
  map: AppMap,
  path: string,
): Promise<void> {
  const inventory: Array<{ kind: ControlKind; label: string }> = [];

  const buttons = await page
    .locator("button:visible, [role='button']:visible")
    .evaluateAll((els) =>
      els.map((el) => {
        const aria = el.getAttribute("aria-label");
        const txt = (el.textContent ?? "").trim();
        return aria && aria.length > 0 ? aria : txt;
      }),
    )
    .catch(() => [] as string[]);
  for (const lbl of buttons) {
    if (!lbl) continue;
    inventory.push({ kind: "button", label: lbl });
  }

  const switches = await page
    .locator('[data-slot="switch"]:visible')
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? "(unlabeled)"),
    )
    .catch(() => [] as string[]);
  for (const lbl of switches) {
    inventory.push({ kind: "switch", label: lbl });
  }

  const selects = await page
    .locator("select:visible")
    .evaluateAll((els) =>
      els.map((el) => {
        const aria = el.getAttribute("aria-label");
        const name = (el as HTMLSelectElement).name;
        return aria || name || "(unnamed select)";
      }),
    )
    .catch(() => [] as string[]);
  for (const lbl of selects) {
    inventory.push({ kind: "select", label: lbl });
  }

  for (const { kind, label } of inventory) {
    // Zero-delta record — establishes the affordance in the map
    // without affecting click/error counters. Subsequent
    // recordControl() calls from the poke phase accumulate.
    recordControlInMap(map, path, kind, label, {});
  }
}

/** Render a `FormOutcome` into the message text used in the
 * recorded finding. Kept here so the spec stays a thin
 * orchestrator. */
export function describeOutcome(outcome: FormOutcome): string {
  switch (outcome.kind) {
    case "network": {
      const base = `${outcome.method} ${outcome.url} → ${outcome.status}`;
      // For 4xx/5xx, show the response body so the operator can
      // see WHY the server rejected (e.g. zod parse error
      // citing the field that failed validation). An explicit
      // `[empty body]` tail when the server returned status
      // but no payload — distinguishes "we forgot to capture"
      // from "the route really did 500 silently".
      if (outcome.status >= 400) {
        return outcome.body
          ? `${base} — ${outcome.body}`
          : `${base} — [empty body]`;
      }
      // 2xx but not persisted: the route returned a success status
      // without row evidence in the body. Show the captured body
      // so the operator can see what came back instead of a row.
      if (!outcome.persisted) {
        return outcome.body
          ? `${base} — NOT PERSISTED — body: ${outcome.body}`
          : `${base} — NOT PERSISTED — [empty body]`;
      }
      return base;
    }
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
