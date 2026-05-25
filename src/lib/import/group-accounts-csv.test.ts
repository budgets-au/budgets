import { describe, expect, it } from "vitest";
import {
  groupAccountsCsv,
  type AccountCsvInputRow,
} from "./group-accounts-csv";

function row(
  overrides: Partial<AccountCsvInputRow> &
    Pick<AccountCsvInputRow, "name" | "startingBalance">,
): AccountCsvInputRow {
  return {
    type: "checking",
    isArchived: false,
    ...overrides,
  };
}

describe("groupAccountsCsv", () => {
  it("returns [] on empty input", () => {
    expect(groupAccountsCsv([])).toEqual([]);
  });

  it("collapses 30 daily rows of one account into 1 preview anchored at the earliest date", () => {
    const rows: AccountCsvInputRow[] = Array.from({ length: 30 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return row({
        name: "Cheque",
        accountNumberLast4: "1234",
        startingDate: `2026-05-${day}`,
        startingBalance: (1000 + i * 10).toFixed(2),
      });
    });
    const out = groupAccountsCsv(rows);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Cheque");
    // Earliest-date row is May-01 with balance 1000.00.
    expect(out[0].startingDate).toBe("2026-05-01");
    expect(out[0].startingBalance).toBe("1000.00");
    // Series captured for every row, ASC.
    expect(out[0].balanceSeries).toHaveLength(30);
    expect(out[0].balanceSeries[0]).toEqual({
      date: "2026-05-01",
      balance: "1000.00",
    });
    expect(out[0].balanceSeries[29]).toEqual({
      date: "2026-05-30",
      balance: "1290.00",
    });
  });

  it("groups two accounts interleaved in the file", () => {
    // Input is shuffled — group key (name + last4) is what matters,
    // not insertion order.
    const rows: AccountCsvInputRow[] = [
      row({ name: "Cheque", accountNumberLast4: "1111", startingDate: "2026-05-02", startingBalance: "200" }),
      row({ name: "Savings", accountNumberLast4: "2222", startingDate: "2026-05-01", startingBalance: "5000" }),
      row({ name: "Cheque", accountNumberLast4: "1111", startingDate: "2026-05-01", startingBalance: "100" }),
      row({ name: "Savings", accountNumberLast4: "2222", startingDate: "2026-05-02", startingBalance: "5100" }),
    ];
    const out = groupAccountsCsv(rows);
    expect(out).toHaveLength(2);
    const cheque = out.find((g) => g.name === "Cheque")!;
    const savings = out.find((g) => g.name === "Savings")!;
    expect(cheque.startingDate).toBe("2026-05-01");
    expect(cheque.startingBalance).toBe("100");
    expect(savings.startingDate).toBe("2026-05-01");
    expect(savings.startingBalance).toBe("5000");
    expect(cheque.balanceSeries).toHaveLength(2);
    expect(savings.balanceSeries).toHaveLength(2);
  });

  it("treats same name with different last4 as separate accounts", () => {
    const rows: AccountCsvInputRow[] = [
      row({ name: "Cheque", accountNumberLast4: "1111", startingDate: "2026-05-01", startingBalance: "100" }),
      row({ name: "Cheque", accountNumberLast4: "2222", startingDate: "2026-05-01", startingBalance: "500" }),
    ];
    expect(groupAccountsCsv(rows)).toHaveLength(2);
  });

  it("groups by name alone when last4 is missing on both sides", () => {
    const rows: AccountCsvInputRow[] = [
      row({ name: "Super", startingDate: "2026-05-01", startingBalance: "100000" }),
      row({ name: "Super", startingDate: "2026-05-02", startingBalance: "100100" }),
    ];
    const out = groupAccountsCsv(rows);
    expect(out).toHaveLength(1);
    expect(out[0].balanceSeries).toHaveLength(2);
  });

  it("drops rows without a parseable date from the series but still emits a preview", () => {
    const rows: AccountCsvInputRow[] = [
      // No date on either row — preview falls back to first-row fields.
      row({ name: "Quirky", startingBalance: "0" }),
    ];
    const out = groupAccountsCsv(rows);
    expect(out).toHaveLength(1);
    expect(out[0].balanceSeries).toEqual([]);
    // startingBalance from the first row, since no anchor candidate.
    expect(out[0].startingBalance).toBe("0");
    expect(out[0].startingDate).toBeUndefined();
  });

  it("same-date duplicates resolve to last-write-wins deterministically", () => {
    const rows: AccountCsvInputRow[] = [
      row({ name: "Cheque", startingDate: "2026-05-01", startingBalance: "100" }),
      row({ name: "Cheque", startingDate: "2026-05-01", startingBalance: "150" }), // later
      row({ name: "Cheque", startingDate: "2026-05-02", startingBalance: "200" }),
    ];
    const out = groupAccountsCsv(rows);
    expect(out).toHaveLength(1);
    // Series has 2 entries (May-01 dedup'd to the later value).
    expect(out[0].balanceSeries).toHaveLength(2);
    expect(out[0].balanceSeries[0]).toEqual({
      date: "2026-05-01",
      balance: "150",
    });
    // Anchor uses the deduped series, so it's the later-write value.
    expect(out[0].startingBalance).toBe("150");
  });

  it("preserves account metadata from the first row in the group", () => {
    const rows: AccountCsvInputRow[] = [
      row({
        name: "Cheque",
        type: "credit",
        institution: "Westpac",
        accountNumberLast4: "1234",
        isArchived: true,
        startingDate: "2026-05-02",
        startingBalance: "200",
      }),
      row({
        name: "Cheque",
        type: "credit",
        institution: "Westpac",
        accountNumberLast4: "1234",
        isArchived: true,
        startingDate: "2026-05-01",
        startingBalance: "100",
      }),
    ];
    const out = groupAccountsCsv(rows);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("credit");
    expect(out[0].institution).toBe("Westpac");
    expect(out[0].accountNumberLast4).toBe("1234");
    expect(out[0].isArchived).toBe(true);
  });
});
