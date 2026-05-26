import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UNDO_IMPORT_TTL_MS,
  clearPendingUndoImport,
  readPendingUndoImport,
  stashPendingUndoImport,
} from "./import-undo";

/** Tiny in-memory polyfill for sessionStorage so the tests can run
 *  in node without jsdom. We attach it to `globalThis.window` so the
 *  module's `typeof window === "undefined"` guard sees it as present. */
function installSessionStorage() {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: { sessionStorage: Storage } }).window = {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  };
}

function uninstallSessionStorage() {
  delete (globalThis as unknown as { window?: unknown }).window;
}

describe("import-undo sessionStorage helpers", () => {
  beforeEach(() => {
    installSessionStorage();
    clearPendingUndoImport();
  });
  afterEach(() => {
    uninstallSessionStorage();
  });

  it("stash → read round-trips the full payload", () => {
    const payload = {
      importLogIds: ["a", "b", "c"],
      imported: 3,
      accountsTouched: 2,
      committedAt: Date.now(),
    };
    stashPendingUndoImport(payload);
    expect(readPendingUndoImport()).toEqual(payload);
  });

  it("clear removes the entry", () => {
    stashPendingUndoImport({
      importLogIds: ["x"],
      imported: 1,
      accountsTouched: 1,
      committedAt: Date.now(),
    });
    clearPendingUndoImport();
    expect(readPendingUndoImport()).toBeNull();
  });

  it("read drops entries past the TTL and returns null", () => {
    const ancient = Date.now() - UNDO_IMPORT_TTL_MS - 1_000;
    stashPendingUndoImport({
      importLogIds: ["stale"],
      imported: 1,
      accountsTouched: 1,
      committedAt: ancient,
    });
    expect(readPendingUndoImport()).toBeNull();
    // The defensive read also clears it for the next caller.
    expect((globalThis as unknown as { window: { sessionStorage: Storage } }).window.sessionStorage.length).toBe(0);
  });

  it("read returns null for a malformed payload", () => {
    (
      globalThis as unknown as { window: { sessionStorage: Storage } }
    ).window.sessionStorage.setItem(
      "budgets:pending-undo-import",
      "{not-json",
    );
    expect(readPendingUndoImport()).toBeNull();
  });

  it("read returns null for a payload missing required fields", () => {
    (
      globalThis as unknown as { window: { sessionStorage: Storage } }
    ).window.sessionStorage.setItem(
      "budgets:pending-undo-import",
      JSON.stringify({ imported: "not a number" }),
    );
    expect(readPendingUndoImport()).toBeNull();
  });

  it("stash / read / clear are no-ops in non-browser environments", () => {
    uninstallSessionStorage();
    expect(() =>
      stashPendingUndoImport({
        importLogIds: [],
        imported: 0,
        accountsTouched: 0,
        committedAt: 0,
      }),
    ).not.toThrow();
    expect(readPendingUndoImport()).toBeNull();
    expect(() => clearPendingUndoImport()).not.toThrow();
  });

  it("stash silently swallows sessionStorage failures (private browsing / quota)", () => {
    installSessionStorage();
    const ss = (globalThis as unknown as { window: { sessionStorage: Storage } })
      .window.sessionStorage;
    const original = ss.setItem;
    ss.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() =>
      stashPendingUndoImport({
        importLogIds: ["q"],
        imported: 1,
        accountsTouched: 1,
        committedAt: Date.now(),
      }),
    ).not.toThrow();
    ss.setItem = original;
  });
});
