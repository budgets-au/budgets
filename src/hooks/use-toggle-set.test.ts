import { describe, expect, it } from "vitest";
import { addToSet, removeFromSet, toggleInSet } from "./use-toggle-set";

/** Tests cover the pure transition helpers exported alongside the
 *  hook. The hook itself is a thin `useState` + useCallback wrapper
 *  that defers to these helpers; testing it inside a React renderer
 *  would require pulling in @testing-library/react just for one
 *  hook, which isn't worth the dep weight. The 6 hook consumers
 *  (cashflow / envelope / yoy / sankey / transactions / category
 *  manager) are exercised by the existing Playwright crawl. */

describe("toggleInSet", () => {
  it("adds the id when absent", () => {
    const prev = new Set<string>();
    const next = toggleInSet(prev, "a");
    expect(next.has("a")).toBe(true);
    expect(next).not.toBe(prev); // new reference
  });
  it("removes the id when present", () => {
    const prev = new Set(["a", "b"]);
    const next = toggleInSet(prev, "a");
    expect(next.has("a")).toBe(false);
    expect(next.has("b")).toBe(true);
  });
  it("returns a fresh Set even on no-op-shaped toggles (delete then add)", () => {
    // The toggle ALWAYS returns a new Set — used by the hook as a
    // signal that the state changed. Important because the hook
    // doesn't try to short-circuit toggles.
    const prev = new Set(["a"]);
    const next = toggleInSet(prev, "a");
    expect(next).not.toBe(prev);
  });
});

describe("addToSet", () => {
  it("adds the id when absent", () => {
    const next = addToSet(new Set(["a"]), "b");
    expect(next.has("a")).toBe(true);
    expect(next.has("b")).toBe(true);
  });
  it("returns the SAME reference when the id is already present (no-op)", () => {
    // Reference equality matters — the hook's setIds(prev =>
    // addToSet(prev, id)) skips React's re-render when the
    // returned ref equals the previous state.
    const prev = new Set(["a"]);
    expect(addToSet(prev, "a")).toBe(prev);
  });
});

describe("removeFromSet", () => {
  it("removes the id when present", () => {
    const next = removeFromSet(new Set(["a", "b"]), "a");
    expect(next.has("a")).toBe(false);
    expect(next.has("b")).toBe(true);
  });
  it("returns the SAME reference when the id isn't present (no-op)", () => {
    const prev = new Set(["a"]);
    expect(removeFromSet(prev, "missing")).toBe(prev);
  });
});
