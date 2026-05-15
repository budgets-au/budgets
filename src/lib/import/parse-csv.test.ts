/** End-to-end parser test against a realistic Westpac CSV sample.
 *
 * The fixture lives at `tests/fixtures/csv-westpac-sample.csv` and
 * is GITIGNORED — bank exports stay on the developer's machine.
 * The suite skips entirely when the file is missing so fresh
 * clones / CI still pass; copy a sample into that path locally to
 * exercise the parser against your own data.
 *
 * What this pins down when the fixture is present:
 *
 *   1. Every row's payee survives parsing (no truncation, no
 *      header-detection mishaps).
 *   2. The Balance column is detected — `runningBalance` populated
 *      on every row.
 *   3. Debit/Credit split parses to signed `amount` strings
 *      (debit → negative, credit → positive).
 *   4. `postedSeq` lands in bank-chronological order via balance
 *      reconciliation: walking by ascending postedSeq reproduces
 *      the bank's running-balance chain (`prev + amount = next`).
 *   5. The chain is invariant to file order — a shuffled re-parse
 *      still produces a chain that walks monotonically.
 *   6. A mangled payee on re-import gives a different importHash
 *      (so exact dedup correctly misses; heuristic is the only
 *      thing that could rescue, gated on payee similarity ≥ 0.5).
 *   7. Re-parsing the exact same file gives identical importHashes
 *      (idempotent dedup).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCSV } from "./parse-csv";

const FIXTURE_PATH = resolve(
  process.cwd(),
  "tests/fixtures/csv-westpac-sample.csv",
);
const fixtureAvailable = existsSync(FIXTURE_PATH);
const SAMPLE_CSV = fixtureAvailable ? readFileSync(FIXTURE_PATH, "utf8") : "";

describe.skipIf(!fixtureAvailable)(
  "parseCSV: Westpac-shaped newest-first sample",
  () => {
    it("detects all columns and parses every body row", () => {
      const rows = parseCSV(SAMPLE_CSV);
      const expected =
        SAMPLE_CSV.trim()
          .split(/\r?\n/)
          .filter((l) => l.length > 0).length - 1; // minus header
      expect(rows).toHaveLength(expected);
    });

    it("converts debit/credit split to signed amounts", () => {
      const rows = parseCSV(SAMPLE_CSV);
      // Any debit row → negative; any credit row → positive.
      const someDebit = rows.find((r) => parseFloat(r.amount) < 0);
      const someCredit = rows.find((r) => parseFloat(r.amount) > 0);
      expect(someDebit).toBeDefined();
      expect(someCredit).toBeDefined();
    });

    it("detects the Balance column (runningBalance populated)", () => {
      const rows = parseCSV(SAMPLE_CSV);
      for (const r of rows) {
        expect(r.runningBalance).toBeTruthy();
        expect(Number.isFinite(parseFloat(r.runningBalance!))).toBe(true);
      }
    });

    it("postedSeq order matches the bank's running-balance progression", () => {
      const rows = parseCSV(SAMPLE_CSV);
      const ordered = rows
        .slice()
        .sort((a, b) => (a.postedSeq ?? 0) - (b.postedSeq ?? 0));
      // Anchor: balance - amount of the first ordered row.
      let prev =
        parseFloat(ordered[0].runningBalance!) -
        parseFloat(ordered[0].amount);
      for (const r of ordered) {
        const expected = prev + parseFloat(r.amount);
        const actual = parseFloat(r.runningBalance!);
        expect(Math.abs(expected - actual)).toBeLessThan(0.01);
        prev = actual;
      }
    });

    it("postedSeq is also chronological by date when the file is newest-first", () => {
      const rows = parseCSV(SAMPLE_CSV);
      const ordered = rows
        .slice()
        .sort((a, b) => (a.postedSeq ?? 0) - (b.postedSeq ?? 0));
      // Dates should ascend (or repeat) along ascending postedSeq.
      for (let i = 1; i < ordered.length; i++) {
        expect(
          ordered[i - 1].date.localeCompare(ordered[i].date),
        ).toBeLessThanOrEqual(0);
      }
    });

    it("shuffling file lines doesn't change the bank-chronological chain", () => {
      const lines = SAMPLE_CSV.trim().split(/\r?\n/);
      const header = lines[0];
      const body = lines.slice(1);
      const shuffled = [
        header,
        ...body.slice().sort((a, b) => a.length - b.length),
      ].join("\n");
      const ordered = parseCSV(shuffled).sort(
        (a, b) => (a.postedSeq ?? 0) - (b.postedSeq ?? 0),
      );
      let prev =
        parseFloat(ordered[0].runningBalance!) -
        parseFloat(ordered[0].amount);
      for (const r of ordered) {
        const expected = prev + parseFloat(r.amount);
        const actual = parseFloat(r.runningBalance!);
        expect(Math.abs(expected - actual)).toBeLessThan(0.01);
        prev = actual;
      }
    });

    it("changing a payee gives a different importHash", () => {
      const original = parseCSV(SAMPLE_CSV);
      // Mangle the first payee — whatever it is — by appending a
      // suffix to the narrative.
      const firstNarrative = original[0].payee;
      const mangled = parseCSV(
        SAMPLE_CSV.replace(firstNarrative, `${firstNarrative} CLOSED`),
      );
      const originalRow = original[0];
      const mangledRow = mangled.find(
        (r) => r.payee === `${firstNarrative} CLOSED`,
      );
      expect(mangledRow).toBeDefined();
      expect(mangledRow!.importHash).not.toBe(originalRow.importHash);
    });

    it("re-parsing the identical file gives identical importHashes (idempotent)", () => {
      const a = parseCSV(SAMPLE_CSV);
      const b = parseCSV(SAMPLE_CSV);
      expect(a.map((r) => r.importHash)).toEqual(b.map((r) => r.importHash));
    });

    it("computed running balance (startingBalance + chain) matches every row's stored bank balance", () => {
      // The actual transactions-list ✗ alert is computed in SQL:
      //   computed = accounts.startingBalance
      //            + SUM(amount WHERE (date, posted_seq, posted_at|created_at, id) <= this row's tuple)
      // vs the stored `transactions.balance` (= bank's claimed
      // running balance at this row).
      //
      // This test simulates the subquery in JS so we exercise the
      // FULL end-to-end behaviour the parser feeds into. If parser-
      // assigned posted_seq is off, this walk diverges from the
      // stored balances and the user sees ✗ on the transactions
      // page — exactly the bug we've been chasing.
      const rows = parseCSV(SAMPLE_CSV);
      const ordered = rows
        .slice()
        .sort((a, b) => (a.postedSeq ?? 0) - (b.postedSeq ?? 0));
      // Derive the implied startingBalance from the chain:
      //   first ordered row's bank balance - that row's amount
      //   = balance BEFORE the first row posted
      //   = account.startingBalance + sum-of-prior-rows (which is 0)
      //   = account.startingBalance.
      const startingBalance =
        parseFloat(ordered[0].runningBalance!) -
        parseFloat(ordered[0].amount);
      // Walk the chain the same way the SQL subquery does.
      let computed = startingBalance;
      for (const r of ordered) {
        computed += parseFloat(r.amount);
        const stored = parseFloat(r.runningBalance!);
        // The transactions-list alert fires when |computed -
        // stored| >= 0.01. Pass test → no ✗ would appear.
        expect(Math.abs(computed - stored)).toBeLessThan(0.01);
      }
    });

    it("reorders correctly even when only the same-date rows are pre-shuffled (worst case for the old sort-by-balance bug)", () => {
      // The failure mode the 0.74 sort-by-balance had: same-date
      // mixed-sign rows ended up reversed. Pre-shuffle only the
      // same-date rows in the file BEFORE parsing to push the
      // parser into the worst case, then re-walk the chain. The
      // 0.78 reconciliation path should still produce a chain
      // that reconciles against startingBalance.
      const lines = SAMPLE_CSV.trim().split(/\r?\n/);
      const header = lines[0];
      const body = lines.slice(1);
      // Group by date column (index 1 in the CSV row).
      const byDate = new Map<string, string[]>();
      for (const line of body) {
        // Quick CSV parse — date is the 2nd field, no quotes
        // around it in this sample.
        const date = line.split(",")[1] ?? "";
        const arr = byDate.get(date) ?? [];
        arr.push(line);
        byDate.set(date, arr);
      }
      // Reverse rows within each date and emit dates in their
      // original order.
      const orderedDates = Array.from(byDate.keys());
      const shuffled = [
        header,
        ...orderedDates.flatMap((d) => (byDate.get(d) ?? []).reverse()),
      ].join("\n");
      const rows = parseCSV(shuffled);
      const ordered = rows
        .slice()
        .sort((a, b) => (a.postedSeq ?? 0) - (b.postedSeq ?? 0));
      const startingBalance =
        parseFloat(ordered[0].runningBalance!) -
        parseFloat(ordered[0].amount);
      let computed = startingBalance;
      for (const r of ordered) {
        computed += parseFloat(r.amount);
        const stored = parseFloat(r.runningBalance!);
        expect(Math.abs(computed - stored)).toBeLessThan(0.01);
      }
    });
  },
);
