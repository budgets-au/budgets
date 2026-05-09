import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { parseISO } from "date-fns";
import { computeCashflow } from "./cashflow";
import type { Account, Transaction, ScheduledTransaction } from "@/db/schema";

// Pin "now" so the past/future logic in computeCashflow is deterministic.
const NOW = new Date("2026-05-06T12:00:00Z");

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: "00000000-0000-0000-0000-0000000000a1",
    name: "Test",
    color: "#000000",
    type: "checking",
    startingBalance: "0.00",
    currentBalance: "10000.00",
    isExternal: false,
    isArchived: false,
    isHiddenInTotals: false,
    isSample: false,
    bankCode: null,
    accountNumber: null,
    notes: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as Account;
}

function makeTxn(overrides: Partial<Transaction>): Transaction {
  return {
    id: `00000000-0000-0000-0000-${Math.random().toString(16).slice(2, 14).padStart(12, "0")}`,
    accountId: "00000000-0000-0000-0000-0000000000a1",
    date: "2026-05-01",
    amount: "-100.00",
    payee: "Payee",
    description: null,
    notes: null,
    categoryId: null,
    isReconciled: false,
    isTransfer: false,
    isSample: false,
    transferPairId: null,
    type: null,
    balance: null,
    importHash: null,
    oldImportHash: null,
    importLogId: null,
    normalizedPayee: null,
    matchPayee: null,
    postedAt: null,
    postedSeq: null,
    rawFitid: null,
    createdAt: new Date("2026-05-01T00:00:00Z"),
    updatedAt: new Date("2026-05-01T00:00:00Z"),
    ...overrides,
  } as Transaction;
}

describe("computeCashflow — back-compute correctness", () => {
  it("past window: closing balance equals currentBalance minus all post-`to` activity", () => {
    // Today: 2026-05-06. currentBalance: 10,000.
    // Txns:
    //   2026-04-15: -200 (rent)
    //   2026-05-03: +1000 (salary, post-`to` for the Apr window)
    //   2026-05-05: -50 (coffee, post-`to` for the Apr window)
    // Past window: from=2026-04-01, to=2026-04-30.
    // Closing balance on Apr 30 must be 10,000 - 1000 + 50 = 9,050.
    const acct = makeAccount({ currentBalance: "10000.00" });
    const txns: Transaction[] = [
      makeTxn({ date: "2026-04-15", amount: "-200.00" }),
      makeTxn({ date: "2026-05-03", amount: "1000.00" }),
      makeTxn({ date: "2026-05-05", amount: "-50.00" }),
    ];
    const result = computeCashflow({
      accounts: [acct],
      realTransactions: txns,
      scheduledTransactions: [],
      from: parseISO("2026-04-01"),
      to: parseISO("2026-04-30"),
    });
    const lastDay = result.daily[result.daily.length - 1];
    expect(lastDay.date).toBe("2026-04-30");
    expect(lastDay.balance).toBe(9050);
  });

  it("past window: per-day balance steps correctly through each txn", () => {
    const acct = makeAccount({ currentBalance: "10000.00" });
    const txns = [
      makeTxn({ date: "2026-04-15", amount: "-200.00" }),
      makeTxn({ date: "2026-05-03", amount: "1000.00" }),
    ];
    const result = computeCashflow({
      accounts: [acct],
      realTransactions: txns,
      scheduledTransactions: [],
      from: parseISO("2026-04-01"),
      to: parseISO("2026-04-30"),
    });
    const byDate = new Map(result.daily.map((d) => [d.date, d.balance]));
    // Apr 1: pre-rent, post-Apr 15 rollback (we'd already subtracted Apr 15
    // and re-added nothing yet): 10,000 - (-200) - 1000 = 9,200.
    expect(byDate.get("2026-04-01")).toBe(9200);
    // Apr 14: still pre-rent. 9,200.
    expect(byDate.get("2026-04-14")).toBe(9200);
    // Apr 15: rent posts (-200). 9,000.
    expect(byDate.get("2026-04-15")).toBe(9000);
    // Apr 30: post-month, salary not yet here (it's May 3). 9,000.
    expect(byDate.get("2026-04-30")).toBe(9000);
  });

  it("future window: closing balance includes projected events", () => {
    // Today: 2026-05-06. currentBalance: 10,000.
    // No real txns. One monthly schedule of -200 starting 2026-05-15.
    // Future window: from=2026-05-06, to=2026-07-15.
    // Expected: 10,000 - 200 (May 15) - 200 (Jun 15) - 200 (Jul 15) = 9,400.
    const acct = makeAccount({ currentBalance: "10000.00" });
    const sched: ScheduledTransaction = {
      id: "00000000-0000-0000-0000-0000000000b1",
      kind: "schedule",
      payee: "Rent",
      description: null,
      amount: "-200.00",
      amountMin: null,
      type: "expense",
      categoryId: null,
      accountId: acct.id,
      transferToAccountId: null,
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 15,
      startDate: "2026-05-15",
      endDate: null,
      isActive: true,
      isPaused: false,
      isSample: false,
      notes: null,
      lineageId: "00000000-0000-0000-0000-0000000000c1",
      supersedesId: null,
      supersededAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    } as ScheduledTransaction;
    const result = computeCashflow({
      accounts: [acct],
      realTransactions: [],
      scheduledTransactions: [sched],
      from: parseISO("2026-05-06"),
      to: parseISO("2026-07-15"),
    });
    const lastDay = result.daily[result.daily.length - 1];
    expect(lastDay.date).toBe("2026-07-15");
    expect(lastDay.balance).toBe(9400);
  });

  it("today's balance equals currentBalance regardless of subsequent txns", () => {
    // Today: 2026-05-06. currentBalance: 10,000. Any txn on today should
    // already be reflected in currentBalance. The series's value for today
    // must equal currentBalance.
    const acct = makeAccount({ currentBalance: "10000.00" });
    const txns = [makeTxn({ date: "2026-05-06", amount: "-100.00" })];
    const result = computeCashflow({
      accounts: [acct],
      realTransactions: txns,
      scheduledTransactions: [],
      from: parseISO("2026-05-01"),
      to: parseISO("2026-05-06"),
    });
    const today = result.daily.find((d) => d.date === "2026-05-06");
    expect(today?.balance).toBe(10000);
  });

  it("multi-account: combined balance is the sum of per-account balances", () => {
    const a = makeAccount({ id: "aa-1", currentBalance: "10000.00" });
    const b = makeAccount({ id: "bb-1", currentBalance: "5000.00" });
    const result = computeCashflow({
      accounts: [a, b],
      realTransactions: [],
      scheduledTransactions: [],
      from: parseISO("2026-05-01"),
      to: parseISO("2026-05-06"),
    });
    expect(result.daily[0].balance).toBe(15000);
    expect(result.perAccount.find((p) => p.id === "aa-1")?.daily[0].balance).toBe(10000);
    expect(result.perAccount.find((p) => p.id === "bb-1")?.daily[0].balance).toBe(5000);
  });

  it("accountIds filter narrows both real and projected events", () => {
    const a = makeAccount({ id: "aa-1", currentBalance: "10000.00" });
    const b = makeAccount({ id: "bb-1", currentBalance: "5000.00" });
    const txns = [makeTxn({ accountId: "bb-1", date: "2026-04-15", amount: "-300.00" })];
    const result = computeCashflow({
      accounts: [a, b],
      realTransactions: txns,
      scheduledTransactions: [],
      from: parseISO("2026-04-01"),
      to: parseISO("2026-04-30"),
      accountIds: ["aa-1"],
    });
    expect(result.perAccount).toHaveLength(1);
    expect(result.perAccount[0].id).toBe("aa-1");
    // bb-1 txn should not affect aa-1's balance.
    expect(result.daily[0].balance).toBe(10000);
  });
});
