import { describe, expect, it } from "vitest";
import { accountIdSql, isUuid, parseAccountIds } from "./account-ids";

const A = "123e4567-e89b-12d3-a456-426614174000";
const B = "550e8400-e29b-41d4-a716-446655440000";

describe("parseAccountIds", () => {
  it("returns [] when the param is missing", () => {
    expect(parseAccountIds(new URLSearchParams())).toEqual([]);
  });

  it("returns [] when the param is empty", () => {
    expect(parseAccountIds(new URLSearchParams("accountIds="))).toEqual([]);
  });

  it("splits a comma-separated list of UUIDs and trims whitespace", () => {
    expect(
      parseAccountIds(new URLSearchParams(`accountIds=${A} , ${B}`)),
    ).toEqual([A, B]);
  });

  it("drops segments that aren't UUIDs — no malformed input reaches the SQL", () => {
    expect(
      parseAccountIds(
        new URLSearchParams(`accountIds=${A},not-a-uuid,${B},,trailing`),
      ),
    ).toEqual([A, B]);
  });
});

describe("isUuid", () => {
  it("accepts canonical UUIDs", () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid(B)).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(A.slice(0, -1))).toBe(false); // missing last char
    expect(isUuid(`${A} `)).toBe(false); // trailing space
  });
});

describe("accountIdSql", () => {
  it("falls back to a non-archived subquery when ids is empty", () => {
    const { accountFilter, accountFilterT } = accountIdSql([]);
    // Drizzle's SQL value: sniff the embedded text — we don't
    // care about exact param-binding format, just that the
    // "non-archived" subquery is in play and no id-list params
    // were emitted.
    const filterStr = JSON.stringify(accountFilter);
    const filterTStr = JSON.stringify(accountFilterT);
    expect(filterStr).toContain("AND account_id IN");
    expect(filterStr).toContain("SELECT id FROM accounts WHERE is_archived = 0");
    expect(filterTStr).toContain("AND t.account_id IN");
    expect(filterTStr).toContain(
      "SELECT id FROM accounts WHERE is_archived = 0",
    );
  });

  it("uses an IN-list of bound params when ids are present", () => {
    const { accountFilter, accountFilterT } = accountIdSql([A, B]);
    const filterStr = JSON.stringify(accountFilter);
    const filterTStr = JSON.stringify(accountFilterT);
    expect(filterStr).toContain("AND account_id IN");
    expect(filterTStr).toContain("AND t.account_id IN");
    // No fallback subquery in this branch.
    expect(filterStr).not.toContain("is_archived");
    expect(filterTStr).not.toContain("is_archived");
    // Each id is a bound param — both UUIDs should appear in the
    // serialized fragment.
    expect(filterStr).toContain(A);
    expect(filterStr).toContain(B);
  });
});
