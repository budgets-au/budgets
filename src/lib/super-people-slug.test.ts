import { describe, expect, it } from "vitest";
import { slugifyPersonKey } from "./super-people";

/** Pure-helper sanity for `slugifyPersonKey` — the only export from
 *  `super-people` that doesn't touch the DB. The other two
 *  (`loadSuperPeople`, `saveSuperPeople`) need the createTestDb
 *  harness and would belong in an integration test if/when the
 *  super-people surface starts carrying real branching logic.
 *  Today the DB path is a single SELECT / INSERT ON CONFLICT — not
 *  worth the test scaffolding overhead. */

describe("slugifyPersonKey", () => {
  it("lower-cases and joins words with hyphens", () => {
    expect(slugifyPersonKey("Jane Smith")).toBe("jane-smith");
    expect(slugifyPersonKey("Bob")).toBe("bob");
  });

  it("strips runs of non-alphanumeric characters", () => {
    expect(slugifyPersonKey("Mum & Dad!")).toBe("mum-dad");
    expect(slugifyPersonKey("__some___thing__")).toBe("some-thing");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugifyPersonKey("--hello--")).toBe("hello");
  });

  it("caps the slug at 40 characters", () => {
    const long = "a".repeat(80);
    expect(slugifyPersonKey(long).length).toBe(40);
  });

  it("falls back to 'person' when the input collapses to empty", () => {
    expect(slugifyPersonKey("!@#$")).toBe("person");
    expect(slugifyPersonKey("   ")).toBe("person");
    expect(slugifyPersonKey("")).toBe("person");
  });
});
