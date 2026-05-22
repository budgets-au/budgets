import { describe, expect, it } from "vitest";
import {
  appendRun,
  bumpConsoleErrors,
  controlSignature,
  emptyAppMap,
  emptyRunCounters,
  ensureRoute,
  GOAL_KEYS,
  isInternalPath,
  migrateAppMap,
  recordControl,
  recordGoalAttempt,
  recordLink,
  type SuccessfulRun,
} from "./_app-map";

const T0 = "2026-05-20T00:00:00.000Z";
const T1 = "2026-05-20T01:00:00.000Z";

describe("emptyAppMap", () => {
  it("returns a schema-versioned shell with all goals reset", () => {
    const m = emptyAppMap();
    expect(m.schemaVersion).toBe(10);
    expect(m.routes).toEqual({});
    expect(m.runs).toEqual([]);
    for (const g of GOAL_KEYS) {
      expect(m.goals[g]).toEqual({
        achieved: false,
        attempts: 0,
        successes: 0,
        lastAttempt: null,
        successfulRun: null,
      });
    }
  });
});

describe("ensureRoute", () => {
  it("creates a fresh record on first visit and bumps visits on subsequent ones", () => {
    const m = emptyAppMap();
    const r = ensureRoute(m, "/dashboard", T0);
    expect(r.firstSeen).toBe(T0);
    expect(r.lastVisited).toBe(T0);
    expect(r.visits).toBe(1);

    const r2 = ensureRoute(m, "/dashboard", T1);
    expect(r2).toBe(r); // same object — caller mutates in place
    expect(r2.firstSeen).toBe(T0); // preserved
    expect(r2.lastVisited).toBe(T1);
    expect(r2.visits).toBe(2);
  });
});

describe("controlSignature", () => {
  it("normalizes whitespace and caps length so the same affordance maps to the same key across runs", () => {
    expect(controlSignature("button", "  Add\n\tTransaction  ")).toBe(
      "button:Add Transaction",
    );
    const long = "x".repeat(200);
    expect(controlSignature("button", long).length).toBeLessThanOrEqual(
      "button:".length + 80,
    );
  });
});

describe("recordControl", () => {
  it("accumulates clicks and merges new observations into a single record", () => {
    const m = emptyAppMap();
    recordControl(m, "/transactions", "button", "Add Transaction", {
      clicks: 1,
    });
    recordControl(m, "/transactions", "button", "Add Transaction", {
      clicks: 1,
      opensDialog: true,
    });
    recordControl(m, "/transactions", "button", "Add Transaction", {
      clicks: 1,
      errored: 1,
    });
    const sig = controlSignature("button", "Add Transaction");
    const c = m.routes["/transactions"].controls[sig];
    expect(c.clicks).toBe(3);
    expect(c.opensDialog).toBe(true); // sticky once observed
    expect(c.errored).toBe(1);
  });

  it("treats kind+label as the identity — two different kinds with the same label are distinct", () => {
    const m = emptyAppMap();
    recordControl(m, "/x", "button", "Save", { clicks: 1 });
    recordControl(m, "/x", "link", "Save", { clicks: 1 });
    expect(Object.keys(m.routes["/x"].controls)).toHaveLength(2);
  });
});

describe("recordLink", () => {
  it("keeps the linksOut set unique and sorted", () => {
    const m = emptyAppMap();
    recordLink(m, "/dashboard", "/transactions");
    recordLink(m, "/dashboard", "/calendar");
    recordLink(m, "/dashboard", "/transactions"); // dup → ignored
    recordLink(m, "/dashboard", "/accounts");
    expect(m.routes["/dashboard"].linksOut).toEqual([
      "/accounts",
      "/calendar",
      "/transactions",
    ]);
  });
});

describe("bumpConsoleErrors", () => {
  it("accumulates across calls so a regression shows up as a monotonic rise", () => {
    const m = emptyAppMap();
    bumpConsoleErrors(m, "/settings");
    bumpConsoleErrors(m, "/settings", 3);
    expect(m.routes["/settings"].consoleErrorCount).toBe(4);
  });
});

describe("recordGoalAttempt", () => {
  const recipe: SuccessfulRun = {
    timestamp: T1,
    route: "/transactions",
    triggerLabel: "Add Transaction",
    fillSpec: { amount: "42", description: "monkey-goal" },
    submitLabel: "Save",
    verified: "dom",
  };

  it("on success: flips achieved=true, stores the recipe, and bumps attempts", () => {
    const m = emptyAppMap();
    recordGoalAttempt(m, "createTransaction", recipe, T1);
    expect(m.goals.createTransaction.achieved).toBe(true);
    expect(m.goals.createTransaction.attempts).toBe(1);
    expect(m.goals.createTransaction.successfulRun).toEqual(recipe);
    expect(m.goals.createTransaction.lastAttempt).toBe(T1);
  });

  it("on failure: bumps attempts but leaves achieved + recipe alone", () => {
    const m = emptyAppMap();
    // First a success, then a failure — the recipe should survive.
    recordGoalAttempt(m, "createTransaction", recipe, T0);
    recordGoalAttempt(m, "createTransaction", null, T1);
    expect(m.goals.createTransaction.achieved).toBe(true);
    expect(m.goals.createTransaction.attempts).toBe(2);
    expect(m.goals.createTransaction.successfulRun).toEqual(recipe);
    expect(m.goals.createTransaction.lastAttempt).toBe(T1);
  });
});

describe("emptyRunCounters", () => {
  it("returns a zeroed ledger covering every RunSummary count field", () => {
    const c = emptyRunCounters();
    expect(c.routesVisited).toBe(0);
    expect(c.buttonClicks).toBe(0);
    expect(c.switchToggles).toBe(0);
    expect(c.selectChanges).toBe(0);
    expect(c.textInputsFilled).toBe(0);
    expect(c.dialogsOpened).toBe(0);
    expect(c.formSubmits).toBe(0);
    expect(c.linksDiscovered).toBe(0);
    expect(c.consoleErrors).toBe(0);
    expect(c.goalsAttempted).toBe(0);
    expect(c.goalsAchieved).toBe(0);
    expect(c.findingsCount).toBe(0);
  });
});

describe("appendRun", () => {
  it("bounds the ring buffer at 20 by dropping the oldest entries", () => {
    const m = emptyAppMap();
    for (let i = 0; i < 25; i++) {
      appendRun(m, {
        ts: `2026-05-20T00:${String(i).padStart(2, "0")}:00.000Z`,
        durationMs: 1000,
        ...emptyRunCounters(),
        routesVisited: 1,
      });
    }
    expect(m.runs).toHaveLength(20);
    // Oldest entry now corresponds to the 6th appendRun call
    // (indices 0-4 were dropped).
    expect(m.runs[0].ts).toBe("2026-05-20T00:05:00.000Z");
    expect(m.runs[19].ts).toBe("2026-05-20T00:24:00.000Z");
  });
});

describe("migrateAppMap", () => {
  // The bug this guards against: a schema bump used to wipe the
  // whole persisted state, so a single-test run after bumping
  // would render TEST-RESULTS.md with one ✅ row and every other
  // goal back at ❌ / 0 attempts. The migrator preserves prior
  // achievements while folding in new fields / goals.
  const runSummary = {
    ts: T1,
    durationMs: 1000,
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
  const recipe: SuccessfulRun = {
    timestamp: T1,
    route: "/transactions",
    triggerLabel: "Add Transaction",
    fillSpec: { amount: "42" },
    submitLabel: "Save",
    verified: "dom",
  };

  it("preserves existing goal achievements from an older-schema map", () => {
    const old = {
      schemaVersion: 7,
      routes: { "/dashboard": { firstSeen: T0, lastVisited: T1, visits: 3, linksOut: [], controls: {}, consoleErrorCount: 0 } },
      runs: [runSummary],
      goals: {
        createTransaction: {
          achieved: true,
          attempts: 3,
          lastAttempt: T1,
          successfulRun: recipe,
          // NOTE: no `successes` field — added in schema 8
        },
        createBudget: {
          achieved: false,
          attempts: 1,
          lastAttempt: T1,
          successfulRun: null,
        },
      },
    };
    const m = migrateAppMap(old as Record<string, unknown>);
    expect(m.schemaVersion).toBe(10);
    // Preserved.
    expect(m.goals.createTransaction.achieved).toBe(true);
    expect(m.goals.createTransaction.attempts).toBe(3);
    expect(m.goals.createTransaction.successfulRun).toEqual(recipe);
    // Backfilled from successfulRun presence (schema-8 default).
    expect(m.goals.createTransaction.successes).toBe(1);
    // createBudget: not achieved, no successfulRun → successes 0.
    expect(m.goals.createBudget.successes).toBe(0);
    expect(m.goals.createBudget.attempts).toBe(1);
    // Goals not in the old map (e.g. resetBrowserData added in
    // schema 9) initialise to fresh defaults — not wiped.
    expect(m.goals.resetBrowserData).toEqual({
      achieved: false,
      attempts: 0,
      successes: 0,
      lastAttempt: null,
      successfulRun: null,
    });
    // Routes + runs preserved as-is.
    expect(m.routes["/dashboard"].visits).toBe(3);
    expect(m.runs).toHaveLength(1);
  });

  it("returns a fresh map when given garbage / unparseable input", () => {
    // Empty object → fresh map with current schema.
    const m = migrateAppMap({});
    expect(m.schemaVersion).toBe(10);
    expect(m.routes).toEqual({});
    expect(m.runs).toEqual([]);
    // All goals reset to defaults.
    for (const k of GOAL_KEYS) {
      expect(m.goals[k].attempts).toBe(0);
      expect(m.goals[k].achieved).toBe(false);
    }
  });

  it("drops goals from old maps that no longer exist in GOAL_KEYS", () => {
    const old = {
      schemaVersion: 5,
      routes: {},
      runs: [],
      goals: {
        createTransaction: { achieved: true, attempts: 1, lastAttempt: T1, successfulRun: recipe, successes: 1 },
        retiredOldGoal: { achieved: true, attempts: 99, lastAttempt: T1, successfulRun: recipe, successes: 99 },
      },
    };
    const m = migrateAppMap(old as Record<string, unknown>);
    expect(m.goals.createTransaction.attempts).toBe(1);
    expect((m.goals as Record<string, unknown>)["retiredOldGoal"]).toBeUndefined();
  });
});

describe("isInternalPath", () => {
  it("accepts in-app paths", () => {
    expect(isInternalPath("/dashboard")).toBe(true);
    expect(isInternalPath("/transactions/abc")).toBe(true);
  });

  it("rejects external URLs, protocol links, hashes, and empty values", () => {
    expect(isInternalPath("https://example.com")).toBe(false);
    expect(isInternalPath("mailto:x@y")).toBe(false);
    expect(isInternalPath("#section")).toBe(false);
    expect(isInternalPath("")).toBe(false);
    expect(isInternalPath(null)).toBe(false);
    expect(isInternalPath(undefined)).toBe(false);
  });

  it("rejects API and auth paths the crawl shouldn't navigate into", () => {
    expect(isInternalPath("/api/transactions")).toBe(false);
    expect(isInternalPath("/login")).toBe(false);
    expect(isInternalPath("/unlock")).toBe(false);
  });

  it("rejects /login/* and /unlock/* subtrees (#68)", () => {
    expect(isInternalPath("/login/forgot")).toBe(false);
    expect(isInternalPath("/login/verify")).toBe(false);
    expect(isInternalPath("/unlock/recover")).toBe(false);
  });

  it("accepts non-auth paths that happen to start with login/unlock letters (#68)", () => {
    expect(isInternalPath("/loginRequest")).toBe(true);
    expect(isInternalPath("/unlocked-status")).toBe(true);
  });

  it("rejects protocol-relative URLs (//cdn.example.com)", () => {
    expect(isInternalPath("//evil.com")).toBe(false);
  });
});
