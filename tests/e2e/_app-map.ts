import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** On-disk learning store for the Smart Monkey crawl. Persists
 * what we've seen of the app — visited routes, interactive
 * controls, links observed, and the recipes we've discovered for
 * achieving high-level goals (create a transaction, etc.).
 *
 * The whole module is pure orchestration over a single JSON file.
 * Playwright is NOT imported here so the data ops can be unit-
 * tested under Vitest. */

const APP_MAP_PATH = resolve("./tests/e2e/.data/app-map.json");

const APP_MAP_SCHEMA_VERSION = 10 as const;

export type ControlKind = "button" | "switch" | "select" | "input" | "link";

interface ControlKnowledge {
  kind: ControlKind;
  label: string;
  clicks: number;
  /** Set true if a click opened a dialog / drawer the crawl had
   * to dismiss. Used by the goal-driven spec to find "Add X"
   * affordances quickly. */
  opensDialog?: boolean;
  /** If a click changed the URL, the destination path. */
  navigatesTo?: string;
  /** Count of error-class outcomes (console error, 5xx) traced
   * to this control. */
  errored?: number;
}

interface RouteKnowledge {
  firstSeen: string;
  lastVisited: string;
  visits: number;
  /** Unique, sorted list of in-app paths linked from this route. */
  linksOut: string[];
  /** Interactive controls discovered on this route, keyed by
   * `controlSignature()`. */
  controls: Record<string, ControlKnowledge>;
  /** Lifetime count of console errors observed while on this
   * route. A monotonically-rising number across runs is the
   * regression signal. */
  consoleErrorCount: number;
}

export type GoalKey =
  | "createTransaction"
  | "createBudget"
  | "createSchedule"
  | "addTenToCategory"
  | "scheduleOnCalendar"
  | "searchTransaction"
  | "addAndViewNote"
  | "searchForNote"
  | "clearSampleData"
  | "rekeyPassphrase"
  | "multiDbSwitcher"
  | "lockUnlockRoundTrip"
  | "savedFilterDeleteReorder"
  | "resetBrowserData"
  | "addSampleData";

export const GOAL_KEYS: readonly GoalKey[] = [
  "createTransaction",
  "createBudget",
  "createSchedule",
  "addTenToCategory",
  "scheduleOnCalendar",
  "searchTransaction",
  "addAndViewNote",
  "searchForNote",
  "clearSampleData",
  "rekeyPassphrase",
  "multiDbSwitcher",
  "lockUnlockRoundTrip",
  "savedFilterDeleteReorder",
  "resetBrowserData",
  "addSampleData",
];

/** Recipe for repeating a previously-successful goal attempt. The
 * goal-driven spec replays this first on each new run; if the
 * replay still works, the goal is "locked in" and the crawl
 * spends its budget exploring other ground. */
export interface SuccessfulRun {
  timestamp: string;
  route: string;
  /** Selector or accessible name of the "Add X" trigger that
   * opened the form. Recorded for human readability — the
   * replayer searches by label rather than DOM path. */
  triggerLabel: string;
  /** Optional dialog header text (helps the replayer disambiguate
   * between multiple visible dialogs). */
  dialogLabel?: string;
  /** Map of input identifier (name → label → placeholder, in that
   * preference order) to the value the crawl filled. */
  fillSpec: Record<string, string>;
  submitLabel: string;
  /** Whether the side-effect was confirmed via the DOM (preferred)
   * or had to fall back to the API. Tracked so the operator can
   * spot UI staleness. */
  verified: "dom" | "api";
}

interface GoalState {
  achieved: boolean;
  /** Lifetime attempt count (every `recordGoalAttempt` call, success
   *  or not). Persists across runs via the AppMap's on-disk snapshot. */
  attempts: number;
  /** Lifetime success count — used to compute the table's pass-rate
   *  column. Added in schema 8; older maps default to 0 on load. */
  successes: number;
  lastAttempt: string | null;
  successfulRun: SuccessfulRun | null;
}

export interface RunSummary {
  ts: string;
  durationMs: number;
  routesVisited: number;
  /** Per-control-kind exercise counts. Sum gives the legacy
   * `controlsExercised` number; the breakdown is what the TODO
   * run-report table needs. */
  buttonClicks: number;
  switchToggles: number;
  selectChanges: number;
  textInputsFilled: number;
  dialogsOpened: number;
  formSubmits: number;
  linksDiscovered: number;
  consoleErrors: number;
  goalsAttempted: number;
  goalsAchieved: number;
  findingsCount: number;
}

/** Build a fresh per-run counter ledger. Each spec increments
 * its slice during the run, then `appendRun` snapshots it. */
export function emptyRunCounters(): Omit<RunSummary, "ts" | "durationMs"> {
  return {
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
  };
}

export interface AppMap {
  schemaVersion: typeof APP_MAP_SCHEMA_VERSION;
  routes: Record<string, RouteKnowledge>;
  goals: Record<GoalKey, GoalState>;
  /** Ring buffer of the last N runs — used to plot coverage
   * trends in the teardown summary. */
  runs: RunSummary[];
}

const RUNS_RING_SIZE = 20;

export function emptyAppMap(): AppMap {
  const goal = (): GoalState => ({
    achieved: false,
    attempts: 0,
    successes: 0,
    lastAttempt: null,
    successfulRun: null,
  });
  return {
    schemaVersion: APP_MAP_SCHEMA_VERSION,
    routes: {},
    goals: {
      createTransaction: goal(),
      createBudget: goal(),
      createSchedule: goal(),
      addTenToCategory: goal(),
      scheduleOnCalendar: goal(),
      searchTransaction: goal(),
      addAndViewNote: goal(),
      searchForNote: goal(),
      clearSampleData: goal(),
      rekeyPassphrase: goal(),
      multiDbSwitcher: goal(),
      lockUnlockRoundTrip: goal(),
      savedFilterDeleteReorder: goal(),
      resetBrowserData: goal(),
      addSampleData: goal(),
    },
    runs: [],
  };
}

/** Get-or-create the knowledge record for `path`, bumping its
 * visit counter. Caller is responsible for saving — this is the
 * pure data op. */
export function ensureRoute(
  map: AppMap,
  path: string,
  now: string = new Date().toISOString(),
): RouteKnowledge {
  let route = map.routes[path];
  if (!route) {
    route = {
      firstSeen: now,
      lastVisited: now,
      visits: 0,
      linksOut: [],
      controls: {},
      consoleErrorCount: 0,
    };
    map.routes[path] = route;
  }
  route.lastVisited = now;
  route.visits += 1;
  return route;
}

/** Stable signature so the same control across runs maps to the
 * same record. Two controls with the same kind and label are
 * treated as the same affordance — good enough for a learning
 * crawl, and stable across re-renders that shuffle DOM order. */
export function controlSignature(kind: ControlKind, label: string): string {
  return `${kind}:${label.trim().replace(/\s+/g, " ").slice(0, 80)}`;
}

/** Merge a control observation into the map. Repeated calls for
 * the same control accumulate counts; new fields land in place. */
export function recordControl(
  map: AppMap,
  path: string,
  kind: ControlKind,
  label: string,
  observed: Partial<Omit<ControlKnowledge, "kind" | "label">> = {},
): void {
  const route = ensureRoute(map, path);
  const sig = controlSignature(kind, label);
  const prior = route.controls[sig];
  const merged: ControlKnowledge = {
    kind,
    label,
    clicks: (prior?.clicks ?? 0) + (observed.clicks ?? 0),
    opensDialog: observed.opensDialog ?? prior?.opensDialog,
    navigatesTo: observed.navigatesTo ?? prior?.navigatesTo,
    errored: (prior?.errored ?? 0) + (observed.errored ?? 0),
  };
  route.controls[sig] = merged;
}

/** Add a discovered link if we haven't seen it from this route
 * before. Keeps `linksOut` unique and sorted for cheap diffing
 * across runs. */
export function recordLink(map: AppMap, path: string, dest: string): void {
  const route = ensureRoute(map, path);
  if (!route.linksOut.includes(dest)) {
    route.linksOut.push(dest);
    route.linksOut.sort();
  }
}

export function bumpConsoleErrors(
  map: AppMap,
  path: string,
  delta: number = 1,
): void {
  const route = ensureRoute(map, path);
  route.consoleErrorCount += delta;
}

/** Record a goal attempt. `success` set → goal flips to achieved
 * and the recipe is preserved for replay on the next run. */
export function recordGoalAttempt(
  map: AppMap,
  goal: GoalKey,
  success: SuccessfulRun | null,
  now: string = new Date().toISOString(),
): void {
  const state = map.goals[goal];
  state.attempts += 1;
  state.lastAttempt = now;
  if (success) {
    state.achieved = true;
    state.successes += 1;
    state.successfulRun = success;
  }
}

export function appendRun(map: AppMap, run: RunSummary): void {
  map.runs.push(run);
  if (map.runs.length > RUNS_RING_SIZE) {
    map.runs.splice(0, map.runs.length - RUNS_RING_SIZE);
  }
}

/** True if `path` looks like an in-app navigation target the
 * crawl should follow (rather than an external link or a hash
 * scroll). Matches `/foo`, `/foo/bar`, never `http(s)://...`,
 * `mailto:`, `#`, or empty. */
export function isInternalPath(path: string | null | undefined): boolean {
  if (!path) return false;
  if (path.startsWith("/api/")) return false; // never click an API URL
  // Issue #68: exact match on both. `startsWith("/login")` was
  // inconsistent with `=== "/unlock"` — the crawl would also reject
  // `/loginRequest` / `/login/forgot` etc. We don't have such
  // routes today but the asymmetry made the rule's intent
  // ambiguous. Also reject the whole `/login/*` and `/unlock/*`
  // subtrees explicitly (e.g. a future magic-link `/login/verify`
  // shouldn't ricochet through the auth flow mid-crawl).
  if (
    path === "/login" ||
    path === "/unlock" ||
    path.startsWith("/login/") ||
    path.startsWith("/unlock/")
  ) {
    return false;
  }
  return path.startsWith("/") && !path.startsWith("//");
}

/** Read the app-map from disk. On schema mismatch, migrate the
 * persisted state forward into the current shape rather than
 * dropping it on the floor — a bumped schema almost always means
 * "a new goal was added" or "a new counter field was added", and
 * losing every prior goal achievement just because of that is
 * the bug that made single-test runs blank TEST-RESULTS.md
 * (one-row goal table after a schema bump). The migrator is
 * additive: existing goal state survives, new goals/fields get
 * defaults, removed goals get dropped. */
export async function loadAppMap(): Promise<AppMap> {
  if (!existsSync(APP_MAP_PATH)) return emptyAppMap();
  try {
    const raw = JSON.parse(await readFile(APP_MAP_PATH, "utf8")) as unknown;
    if (!raw || typeof raw !== "object") return emptyAppMap();
    const sv = (raw as { schemaVersion?: unknown }).schemaVersion;
    if (sv === APP_MAP_SCHEMA_VERSION) {
      return raw as AppMap;
    }
    return migrateAppMap(raw as Record<string, unknown>);
  } catch {
    return emptyAppMap();
  }
}

/** Forward-migrate a persisted AppMap from any prior schema into
 * the current shape. Strategy: start from `emptyAppMap()` (which
 * has the current schemaVersion + every current GoalKey present
 * with default state), then layer the old fields on top where
 * the shape is still recognisable.
 *
 * - `routes` is preserved as-is — analytics only, schema hasn't
 *   changed structurally between versions.
 * - `runs` is preserved (trimmed to ring size).
 * - `goals` is merged per-key: any old goal that is still in
 *   `GOAL_KEYS` keeps its achieved/attempts/lastAttempt/successfulRun;
 *   `successes` is backfilled from `successfulRun ? 1 : 0` if absent
 *   (the field was added in schema 8). Goals that no longer exist
 *   in the union are dropped; new goals start at default. */
export function migrateAppMap(raw: Record<string, unknown>): AppMap {
  const fresh = emptyAppMap();

  if (raw.routes && typeof raw.routes === "object") {
    fresh.routes = raw.routes as AppMap["routes"];
  }

  if (Array.isArray(raw.runs)) {
    fresh.runs = (raw.runs as RunSummary[]).slice(-RUNS_RING_SIZE);
  }

  if (raw.goals && typeof raw.goals === "object") {
    const oldGoals = raw.goals as Record<string, Partial<GoalState>>;
    for (const key of GOAL_KEYS) {
      const og = oldGoals[key];
      if (!og || typeof og !== "object") continue;
      fresh.goals[key] = {
        achieved: og.achieved ?? false,
        attempts: og.attempts ?? 0,
        successes: og.successes ?? (og.successfulRun ? 1 : 0),
        lastAttempt: og.lastAttempt ?? null,
        successfulRun: og.successfulRun ?? null,
      };
    }
  }

  return fresh;
}

export async function saveAppMap(map: AppMap): Promise<void> {
  await mkdir(dirname(APP_MAP_PATH), { recursive: true });
  await writeFile(APP_MAP_PATH, JSON.stringify(map, null, 2));
}
