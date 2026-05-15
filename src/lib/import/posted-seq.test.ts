import { describe, expect, it } from "vitest";
import { assignPostedSeq } from "./posted-seq";

type Row = {
  date: string;
  runningBalance?: string | null;
  postedSeq?: number | null;
};

function postedSeqs(rows: Row[]): (number | null | undefined)[] {
  return rows.map((r) => r.postedSeq);
}

describe("assignPostedSeq", () => {
  it("oldest-first multi-day file: postedSeq = file position", () => {
    const rows: Row[] = [
      { date: "2026-01-01" },
      { date: "2026-01-02" },
      { date: "2026-01-03" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("newest-first multi-day file: postedSeq reversed", () => {
    const rows: Row[] = [
      { date: "2026-01-03" },
      { date: "2026-01-02" },
      { date: "2026-01-01" },
    ];
    assignPostedSeq(rows);
    // Reversed so higher postedSeq = more recent (matches the
    // running-balance ORDER BY direction).
    expect(postedSeqs(rows)).toEqual([2, 1, 0]);
  });

  it("same-date file with monotonic balances: balance-derived order", () => {
    // File is newest-first within the day (typical bank export).
    // Balance proves the bank's real order: $200 first, $150
    // (after −$50), $100 (after −$50 again).
    const rows: Row[] = [
      { date: "2026-01-15", runningBalance: "100.00" },
      { date: "2026-01-15", runningBalance: "150.00" },
      { date: "2026-01-15", runningBalance: "200.00" },
    ];
    assignPostedSeq(rows);
    // Balance ascending → $100 row earliest in bank order, $200
    // latest. Caller's tuple compare uses these as a tiebreaker
    // within the date.
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("same-date file with monotonic balances, file in reverse: balance still wins", () => {
    const rows: Row[] = [
      { date: "2026-01-15", runningBalance: "200.00" },
      { date: "2026-01-15", runningBalance: "150.00" },
      { date: "2026-01-15", runningBalance: "100.00" },
    ];
    assignPostedSeq(rows);
    // Balance order (asc): rows[2] ($100), rows[1] ($150),
    // rows[0] ($200). So $100 row → postedSeq 0, etc.
    expect(postedSeqs(rows)).toEqual([2, 1, 0]);
  });

  it("same-date file with NO balance: postedSeq = file position", () => {
    const rows: Row[] = [
      { date: "2026-01-15" },
      { date: "2026-01-15" },
      { date: "2026-01-15" },
    ];
    assignPostedSeq(rows);
    // No balance signal, no date inversion → file position.
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("mixed balance/no-balance: falls back to file position", () => {
    const rows: Row[] = [
      { date: "2026-01-01", runningBalance: "100.00" },
      { date: "2026-01-02" }, // missing balance
      { date: "2026-01-03", runningBalance: "200.00" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("balance present but with a same-date / same-balance tie: file position", () => {
    // Two rows on the same date end at the same balance (a $5 IN
    // matched by a $5 OUT). Balance alone can't disambiguate; fall
    // back to file position.
    const rows: Row[] = [
      { date: "2026-01-15", runningBalance: "100.00" },
      { date: "2026-01-15", runningBalance: "105.00" },
      { date: "2026-01-15", runningBalance: "100.00" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("newest-first multi-day file with same-date intra-day: reverses whole file", () => {
    // First row 2026-01-03 > last row 2026-01-01 → newestFirst.
    // Two rows share the 2026-01-03 date but lack balance — the
    // file-position reverse captures both whole-file and intra-day.
    const rows: Row[] = [
      { date: "2026-01-03" },
      { date: "2026-01-03" },
      { date: "2026-01-01" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([2, 1, 0]);
  });

  it("single-row file: postedSeq 0", () => {
    const rows: Row[] = [{ date: "2026-01-01" }];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0]);
  });

  it("empty input: no throw", () => {
    const rows: Row[] = [];
    assignPostedSeq(rows);
    expect(rows).toEqual([]);
  });

  it("balance NaN on one row: falls back to file position", () => {
    const rows: Row[] = [
      { date: "2026-01-01", runningBalance: "100.00" },
      { date: "2026-01-01", runningBalance: "not-a-number" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1]);
  });
});
