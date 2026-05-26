import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./new-id";

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a syntactically valid UUID v4", () => {
    const id = newId();
    expect(id).toMatch(V4_RE);
  });

  it("returns different IDs across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) ids.add(newId());
    expect(ids.size).toBe(50);
  });

  it("falls back to the Math.random polyfill when crypto.randomUUID throws (insecure context)", () => {
    // Simulate the LAN-IP / non-secure-context case: crypto exists,
    // but randomUUID throws. The function should NOT propagate — it
    // should silently use the polyfill and return a valid v4.
    const spy = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("crypto.randomUUID is only available in secure contexts");
    });
    const id = newId();
    expect(spy).toHaveBeenCalled();
    expect(id).toMatch(V4_RE);
  });
});
