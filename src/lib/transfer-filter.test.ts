import { describe, expect, it } from "vitest";
import { isTransferRow, mkIsTransferRow } from "./transfer-filter";

/** The transfer-filter helpers are SQL fragments. We can't run them
 *  against a database without the full drizzle pipeline, but we
 *  CAN pin the fragment's queryChunks shape so a refactor that
 *  changes the column name or alias (e.g. renames transfer_pair_id)
 *  fails loudly. The contract this file guards: it MUST reference
 *  `transfer_pair_id` and use the supplied alias verbatim. */

/** Recursively flatten the SQL fragment's internal structure into
 *  a plain-text representation so assertions can match against
 *  individual tokens. Drizzle wraps text chunks in nested
 *  `.value`/`.queryChunks` arrays — naive `JSON.stringify` keeps
 *  them as separate values, breaking `toContain("x.transfer_pair_id")`. */
function fragmentString(frag: unknown): string {
  if (frag == null) return "";
  if (typeof frag === "string") return frag;
  if (Array.isArray(frag)) return frag.map(fragmentString).join("");
  if (typeof frag === "object") {
    const o = frag as Record<string, unknown>;
    if (Array.isArray(o.value)) return fragmentString(o.value);
    if (Array.isArray(o.queryChunks)) return fragmentString(o.queryChunks);
  }
  return "";
}

describe("isTransferRow", () => {
  it("references transfer_pair_id IS NOT NULL on the default `t` alias", () => {
    const s = fragmentString(isTransferRow as unknown as { queryChunks: unknown[] });
    expect(s).toContain("transfer_pair_id");
    expect(s).toContain("IS NOT NULL");
    expect(s).toContain("t");
  });
});

describe("mkIsTransferRow", () => {
  it("uses the supplied alias verbatim", () => {
    const frag = mkIsTransferRow("x");
    const s = fragmentString(frag as unknown as { queryChunks: unknown[] });
    expect(s).toContain("x.transfer_pair_id");
    expect(s).toContain("IS NOT NULL");
  });

  it("supports common join aliases without collision", () => {
    const ledger = mkIsTransferRow("ledger");
    const target = mkIsTransferRow("target");
    expect(
      fragmentString(ledger as unknown as { queryChunks: unknown[] }),
    ).toContain("ledger.transfer_pair_id");
    expect(
      fragmentString(target as unknown as { queryChunks: unknown[] }),
    ).toContain("target.transfer_pair_id");
  });
});
