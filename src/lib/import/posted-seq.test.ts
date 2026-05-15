import { describe, expect, it } from "vitest";
import { assignPostedSeq } from "./posted-seq";

type Row = {
  date: string;
  amount: string;
  runningBalance?: string | null;
  postedSeq?: number | null;
};

function postedSeqs(rows: Row[]): (number | null | undefined)[] {
  return rows.map((r) => r.postedSeq);
}

describe("assignPostedSeq", () => {
  it("oldest-first multi-day file (no balance): postedSeq = file position", () => {
    const rows: Row[] = [
      { date: "2026-01-01", amount: "10.00" },
      { date: "2026-01-02", amount: "20.00" },
      { date: "2026-01-03", amount: "30.00" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("newest-first multi-day file (no balance): postedSeq reversed", () => {
    const rows: Row[] = [
      { date: "2026-01-03", amount: "30.00" },
      { date: "2026-01-02", amount: "20.00" },
      { date: "2026-01-01", amount: "10.00" },
    ];
    assignPostedSeq(rows);
    // Reversed so higher postedSeq = more recent.
    expect(postedSeqs(rows)).toEqual([2, 1, 0]);
  });

  it("same-date file with all deposits: balance reconciliation orders correctly", () => {
    // Starting balance 50; three deposits land in order. File is in
    // newest-first order — reconciliation should produce the true
    // chronological order regardless.
    const rows: Row[] = [
      { date: "2026-01-15", amount: "30.00", runningBalance: "120.00" }, // last (file position 0)
      { date: "2026-01-15", amount: "20.00", runningBalance: "90.00" }, // middle
      { date: "2026-01-15", amount: "40.00", runningBalance: "70.00" }, // first (file position 2)
    ];
    assignPostedSeq(rows);
    // Bank order: $40 (70), $20 (90), $30 (120). File position 2 →
    // postedSeq 0; position 1 → 1; position 0 → 2.
    expect(postedSeqs(rows)).toEqual([2, 1, 0]);
  });

  it("same-date file with mixed signs: reconciliation handles outflow days correctly", () => {
    // The case my old code got wrong. Starting at 1000:
    //   +100 → 1100 (first)
    //   -200 → 900  (second)
    //   -150 → 750  (third)
    // Naive sort-by-balance asc would put 750 first; reconciliation
    // walks `prev + amount = next` and gets the real order.
    const rows: Row[] = [
      { date: "2026-01-15", amount: "100.00", runningBalance: "1100.00" },
      { date: "2026-01-15", amount: "-200.00", runningBalance: "900.00" },
      { date: "2026-01-15", amount: "-150.00", runningBalance: "750.00" },
    ];
    assignPostedSeq(rows);
    // File order already matches bank order → postedSeq 0,1,2.
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("same-date file with mixed signs in reverse: reconciliation flips back", () => {
    // Same bank order as above but file is reversed (newest-first).
    const rows: Row[] = [
      { date: "2026-01-15", amount: "-150.00", runningBalance: "750.00" }, // bank's 3rd
      { date: "2026-01-15", amount: "-200.00", runningBalance: "900.00" }, // bank's 2nd
      { date: "2026-01-15", amount: "100.00", runningBalance: "1100.00" }, // bank's 1st
    ];
    assignPostedSeq(rows);
    // Bank order: file[2] (1st), file[1] (2nd), file[0] (3rd).
    expect(postedSeqs(rows)).toEqual([2, 1, 0]);
  });

  it("multi-day with anchor: each day's intra-day order derived from previous day's last balance", () => {
    // Day 1: +50 from 0 → 50, +20 → 70.
    // Day 2: -10 from 70 → 60, +30 → 90, +5 → 95.
    // File order shuffled within each day.
    const rows: Row[] = [
      { date: "2026-01-01", amount: "20.00", runningBalance: "70.00" },
      { date: "2026-01-01", amount: "50.00", runningBalance: "50.00" },
      { date: "2026-01-02", amount: "5.00", runningBalance: "95.00" },
      { date: "2026-01-02", amount: "-10.00", runningBalance: "60.00" },
      { date: "2026-01-02", amount: "30.00", runningBalance: "90.00" },
    ];
    assignPostedSeq(rows);
    // Bank order: 50, 70, 60, 90, 95. Map back to original indices:
    //   file[1] (50)  → 0
    //   file[0] (70)  → 1
    //   file[3] (60)  → 2
    //   file[4] (90)  → 3
    //   file[2] (95)  → 4
    expect(postedSeqs(rows)).toEqual([1, 0, 4, 2, 3]);
  });

  it("same-date file with NO balance: postedSeq = file position", () => {
    const rows: Row[] = [
      { date: "2026-01-15", amount: "10.00" },
      { date: "2026-01-15", amount: "20.00" },
      { date: "2026-01-15", amount: "30.00" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("mixed balance/no-balance: falls back to file position", () => {
    const rows: Row[] = [
      { date: "2026-01-01", amount: "10.00", runningBalance: "10.00" },
      { date: "2026-01-02", amount: "20.00" },
      { date: "2026-01-03", amount: "30.00", runningBalance: "60.00" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1, 2]);
  });

  it("ambiguous same-day round-trip (no unique reconciliation): falls back to file position", () => {
    // +5 then -5: balance returns to start. From the file alone the
    // bank's order between these two is genuinely indeterminate; both
    // (+5,-5) and (-5,+5) reconcile from anchor=0.
    const rows: Row[] = [
      { date: "2026-01-15", amount: "5.00", runningBalance: "5.00" },
      { date: "2026-01-15", amount: "-5.00", runningBalance: "0.00" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1]);
  });

  it("newest-first multi-day file with same-date intra-day (no balance): reverses whole file", () => {
    // Two rows share 2026-01-03. No balance → file-position +
    // date-inversion check fires.
    const rows: Row[] = [
      { date: "2026-01-03", amount: "10.00" },
      { date: "2026-01-03", amount: "20.00" },
      { date: "2026-01-01", amount: "30.00" },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([2, 1, 0]);
  });

  it("single-row file: postedSeq 0", () => {
    const rows: Row[] = [{ date: "2026-01-01", amount: "10.00" }];
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
      { date: "2026-01-01", amount: "10.00", runningBalance: "10.00" },
      {
        date: "2026-01-01",
        amount: "20.00",
        runningBalance: "not-a-number",
      },
    ];
    assignPostedSeq(rows);
    expect(postedSeqs(rows)).toEqual([0, 1]);
  });
});
