import { describe, it, expect } from "vitest";
import { parseISO } from "date-fns";
import { expandRecurrence } from "./recurrence";
import type { ScheduledTransaction } from "@/db/schema";

function makeSchedule(overrides: Partial<ScheduledTransaction>): ScheduledTransaction {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    kind: "schedule",
    payee: "Test",
    description: "Test",
    amount: "100.00",
    amountMin: null,
    type: "expense",
    categoryId: null,
    accountId: "00000000-0000-0000-0000-0000000000aa",
    transferToAccountId: null,
    frequency: "monthly",
    interval: 1,
    dayOfMonth: null,
    startDate: "2026-01-31",
    endDate: null,
    isActive: true,
    isPaused: false,
    isSample: false,
    notes: null,
    lineageId: "00000000-0000-0000-0000-0000000000bb",
    supersedesId: null,
    supersededAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as ScheduledTransaction;
}

describe("expandRecurrence — monthly drift", () => {
  it("keeps a 31st-of-month schedule on the 31st (re-anchors after short months)", () => {
    // startDate is the 31st; dayOfMonth not set explicitly. The expected
    // behaviour is that the schedule lands on the 31st whenever the month
    // permits and clamps to month-end otherwise. Without the fix the cursor
    // drifts down to 28 after February and never recovers.
    const s = makeSchedule({
      startDate: "2026-01-31",
      dayOfMonth: null,
    });
    const events = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-07-31"),
    );
    const dates = events.map((e) => e.date);
    expect(dates).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
    ]);
  });

  it("explicit dayOfMonth=31 anchors the same way", () => {
    const s = makeSchedule({
      startDate: "2026-01-31",
      dayOfMonth: 31,
    });
    const events = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-07-31"),
    );
    const dates = events.map((e) => e.date);
    expect(dates).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
    ]);
  });

  it("a mid-month schedule (15th) is unaffected by the fix", () => {
    const s = makeSchedule({
      startDate: "2026-01-15",
      dayOfMonth: null,
    });
    const events = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-04-30"),
    );
    expect(events.map((e) => e.date)).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
    ]);
  });

  it("a 30th-of-month schedule lands on Feb 28 then back to 30", () => {
    const s = makeSchedule({
      startDate: "2026-01-30",
      dayOfMonth: null,
    });
    const events = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-04-30"),
    );
    expect(events.map((e) => e.date)).toEqual([
      "2026-01-30",
      "2026-02-28",
      "2026-03-30",
      "2026-04-30",
    ]);
  });
});

describe("expandRecurrence — basics", () => {
  it("weekly expansion emits every 7 days", () => {
    const s = makeSchedule({
      startDate: "2026-01-05",
      frequency: "weekly",
      interval: 1,
    });
    const events = expandRecurrence(
      s,
      parseISO("2026-01-05"),
      parseISO("2026-02-02"),
    );
    expect(events.map((e) => e.date)).toEqual([
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
      "2026-02-02",
    ]);
  });

  it("once-frequency schedules emit a single occurrence inside the range", () => {
    const s = makeSchedule({
      startDate: "2026-03-15",
      frequency: "once",
      interval: 1,
    });
    expect(
      expandRecurrence(s, parseISO("2026-03-01"), parseISO("2026-03-31")).map(
        (e) => e.date,
      ),
    ).toEqual(["2026-03-15"]);
    expect(
      expandRecurrence(s, parseISO("2026-04-01"), parseISO("2026-04-30")),
    ).toEqual([]);
  });

  it("budgets are excluded from expansion unless includeBudgets is set", () => {
    const s = makeSchedule({
      kind: "budget",
      startDate: "2026-01-01",
      frequency: "monthly",
      interval: 1,
    });
    expect(
      expandRecurrence(s, parseISO("2026-01-01"), parseISO("2026-04-30")),
    ).toEqual([]);
    const events = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-04-30"),
      { includeBudgets: true },
    );
    expect(events.map((e) => e.date)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
  });

  it("transfers emit two events (source + destination) per occurrence", () => {
    const s = makeSchedule({
      type: "transfer",
      amount: "-200.00",
      transferToAccountId: "00000000-0000-0000-0000-0000000000cc",
      startDate: "2026-01-15",
      frequency: "monthly",
      interval: 1,
    });
    const events = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-02-28"),
    );
    expect(events).toHaveLength(4); // 2 occurrences × 2 legs
    const jan = events.filter((e) => e.date === "2026-01-15");
    expect(jan).toHaveLength(2);
    const sourceJan = jan.find((e) => e.accountId === s.accountId);
    const destJan = jan.find((e) => e.accountId === s.transferToAccountId);
    expect(sourceJan?.amount).toBe("-200.00");
    expect(destJan?.amount).toBe("200");
  });

  it("transfer projection yields one source-leg event per occurrence (cashflow Plan column)", () => {
    // Regression: the cashflow report's per-category projection loop sums
    // `Math.abs(amount)` over expandRecurrence events. Transfers emit BOTH
    // legs, so without filtering by source the Plan column doubles. This
    // test pins the contract the route now relies on:
    //   `events.filter(e => e.accountId === schedule.accountId).length`
    // equals the number of occurrences in the window.
    const s = makeSchedule({
      type: "transfer",
      amount: "1000.00",
      transferToAccountId: "00000000-0000-0000-0000-0000000000cc",
      startDate: "2026-01-01",
      frequency: "monthly",
      interval: 1,
    });
    const events = expandRecurrence(
      s,
      parseISO("2026-01-01"),
      parseISO("2026-03-31"),
    );
    // Three occurrences, two legs each → six raw events.
    expect(events).toHaveLength(6);
    const sourceLegs = events.filter((e) => e.accountId === s.accountId);
    // Filtered to source only → one event per occurrence; sum of |amount|
    // is 1000 × 3 = 3000, NOT 6000.
    expect(sourceLegs).toHaveLength(3);
    const total = sourceLegs.reduce(
      (sum, e) => sum + Math.abs(parseFloat(e.amount)),
      0,
    );
    expect(total).toBe(3000);
  });

  it("respects endDate by truncating the series", () => {
    const s = makeSchedule({
      startDate: "2026-01-01",
      endDate: "2026-03-15",
      frequency: "monthly",
      interval: 1,
    });
    expect(
      expandRecurrence(s, parseISO("2026-01-01"), parseISO("2026-12-31")).map(
        (e) => e.date,
      ),
    ).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});
