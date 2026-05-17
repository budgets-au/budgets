import { describe, it, expect } from "vitest";
import { parseISO } from "date-fns";
import { expandRecurrence } from "./recurrence";
import { matchSchedule, type MatchableTxn } from "./scheduled-match";
import type { ScheduledTransaction } from "@/db/schema";

/** Regression suite for the false-positive "missed payment" warning on
 *  scheduled transfers. The bug:
 *
 *  1. expandRecurrence projects BOTH legs of a transfer (source + dest).
 *  2. matchSchedule gates candidates by the schedule's categoryId.
 *  3. The transfer auto-matcher only categorises the SOURCE leg; the
 *     destination keeps its original (usually NULL) category.
 *  4. The destination occurrence then fails the category filter →
 *     "missed" warning even though the pair is correct in the DB.
 *
 *  The fix is to project a single (source) leg when matching. The
 *  destination's match status is established via transfer_pair_id at
 *  the consumer level. */

function makeTransferSchedule(): ScheduledTransaction {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    kind: "schedule",
    payee: "Loan Payment",
    description: "Loan Payment",
    amount: "-500.00",
    amountMin: null,
    type: "transfer",
    categoryId: "00000000-0000-0000-0000-0000000000c1",
    accountId: "00000000-0000-0000-0000-0000000000aa",
    transferToAccountId: "00000000-0000-0000-0000-0000000000bb",
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 15,
    startDate: "2026-01-15",
    endDate: null,
    isActive: true,
    isPaused: false,
    isSample: false,
    notes: null,
    lineageId: "00000000-0000-0000-0000-0000000000ee",
    supersedesId: null,
    supersededAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as ScheduledTransaction;
}

describe("scheduled-transfer matching — false-positive missed", () => {
  it("reproduces the bug when projecting BOTH legs with a category filter", () => {
    const s = makeTransferSchedule();
    const projected = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-03-31"),
    );
    // 3 monthly occurrences × 2 legs = 6 events
    expect(projected).toHaveLength(6);

    // Real transactions: each occurrence's source leg got auto-
    // categorised by the transfer matcher (to the schedule's Loan
    // Payment category); the destination leg kept its NULL category
    // because the matcher only touches the uncategorised SOURCE side.
    const txns: MatchableTxn[] = [];
    for (const date of ["2026-01-15", "2026-02-15", "2026-03-15"]) {
      txns.push({
        id: `src-${date}`,
        accountId: s.accountId!,
        date,
        amount: "-500.00",
        categoryId: s.categoryId, // auto-matcher set this
      });
      txns.push({
        id: `dst-${date}`,
        accountId: s.transferToAccountId!,
        date,
        amount: "500.00",
        categoryId: null, // auto-matcher left this alone — the bug trigger
      });
    }

    const allowed = new Set<string>([s.categoryId!]);
    const result = matchSchedule(
      projected.map((p) => ({
        date: p.date,
        accountId: p.accountId,
        amount: parseFloat(p.amount),
      })),
      txns,
      {
        rangeMin: null,
        frequency: s.frequency!,
        interval: s.interval!,
        allowedCategoryIds: allowed,
        claimedTxnIds: new Set(),
      },
    );
    // Only the source legs match; destination legs fall through the
    // category filter and surface as "missed" — three false positives.
    expect(result.matched.map((m) => m.txnId).sort()).toEqual([
      "src-2026-01-15",
      "src-2026-02-15",
      "src-2026-03-15",
    ]);
    expect(result.unmatched).toHaveLength(3);
    for (const u of result.unmatched) {
      expect(u.accountId).toBe(s.transferToAccountId);
    }
  });

  it("fix: single-leg projection (transferDualLeg=false) matches all source legs and emits no false missed", () => {
    const s = makeTransferSchedule();
    const projected = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-03-31"),
      { transferDualLeg: false },
    );
    // 3 monthly occurrences × 1 (source) leg = 3 events
    expect(projected).toHaveLength(3);
    for (const e of projected) {
      expect(e.accountId).toBe(s.accountId);
    }

    const txns: MatchableTxn[] = [];
    for (const date of ["2026-01-15", "2026-02-15", "2026-03-15"]) {
      txns.push({
        id: `src-${date}`,
        accountId: s.accountId!,
        date,
        amount: "-500.00",
        categoryId: s.categoryId,
      });
      txns.push({
        id: `dst-${date}`,
        accountId: s.transferToAccountId!,
        date,
        amount: "500.00",
        categoryId: null,
      });
    }
    const allowed = new Set<string>([s.categoryId!]);
    const result = matchSchedule(
      projected.map((p) => ({
        date: p.date,
        accountId: p.accountId,
        amount: parseFloat(p.amount),
      })),
      txns,
      {
        rangeMin: null,
        frequency: s.frequency!,
        interval: s.interval!,
        allowedCategoryIds: allowed,
        claimedTxnIds: new Set(),
      },
    );
    expect(result.matched.map((m) => m.txnId).sort()).toEqual([
      "src-2026-01-15",
      "src-2026-02-15",
      "src-2026-03-15",
    ]);
    // No false "missed" — the consumer reconstructs the destination
    // side from the source's transfer_pair_id, not from a parallel
    // matcher pass.
    expect(result.unmatched).toEqual([]);
  });
});
