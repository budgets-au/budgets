import { describe, it, expect } from "vitest";
import { parseQIF } from "./parse-qif";

describe("parseQIF — single-account basic", () => {
  it("parses a simple Bank-type QIF", () => {
    const qif = `!Type:Bank
D15/01/2026
T-50.00
PWoolworths
MWeekly groceries
^
D16/01/2026
T1200.00
PSalary
^`;
    const rows = parseQIF(qif);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-01-15",
      amount: "-50.00",
      payee: "Woolworths",
      description: "Weekly groceries",
    });
    expect(rows[1]).toMatchObject({
      date: "2026-01-16",
      amount: "1200.00",
      payee: "Salary",
    });
  });

  it("falls back to memo when payee is missing (Westpac/NAB shape)", () => {
    const qif = `!Type:Bank
D02/02/2026
T-25.00
MEFT to friend
^`;
    const rows = parseQIF(qif);
    expect(rows[0].payee).toBe("EFT to friend");
    expect(rows[0].description).toBe("EFT to friend");
  });

  it("ignores unrecognised opcodes", () => {
    const qif = `!Type:Bank
D03/03/2026
T-10.00
PCoffee
ZUNKNOWN_OPCODE
^`;
    const rows = parseQIF(qif);
    expect(rows).toHaveLength(1);
    expect(rows[0].payee).toBe("Coffee");
  });
});

describe("parseQIF — multi-account state machine", () => {
  it("tags rows with the most recently declared !Account", () => {
    const qif = `!Account
NEveryday
TBank
^
!Type:Bank
D04/04/2026
T-30.00
PCafe
^
!Account
NSavings
TBank
^
!Type:Bank
D04/04/2026
T-100.00
PRent transfer
^`;
    const rows = parseQIF(qif);
    expect(rows).toHaveLength(2);
    expect(rows[0].qifAccount?.name).toBe("Everyday");
    expect(rows[1].qifAccount?.name).toBe("Savings");
  });

  it("flushes a mid-build transaction when a new !Account appears (missing ^)", () => {
    // The first txn is missing its trailing ^ — the !Account line should
    // emit the in-flight row before switching contexts.
    const qif = `!Account
NEveryday
^
!Type:Bank
D05/05/2026
T-15.00
PInterrupted txn
!Account
NSavings
^
!Type:Bank
D06/05/2026
T-20.00
POther
^`;
    const rows = parseQIF(qif);
    // The first txn (no ^) gets flushed by !Account; the second is normal.
    const payees = rows.map((r) => r.payee);
    expect(payees).toContain("Interrupted txn");
    expect(payees).toContain("Other");
  });
});

describe("parseQIF — splits", () => {
  it("attaches S/E/$ to the same parent transaction", () => {
    const qif = `!Type:Bank
D10/10/2026
T-100.00
PSupermarket
SFood:Groceries
EFood items
$-80.00
SHousehold
EPaper goods
$-20.00
^`;
    const rows = parseQIF(qif);
    expect(rows).toHaveLength(1);
    expect(rows[0].splits).toEqual([
      { category: "Food:Groceries", memo: "Food items", amount: "-80.00" },
      { category: "Household", memo: "Paper goods", amount: "-20.00" },
    ]);
  });
});

describe("parseQIF — date format permutations", () => {
  it("accepts dd/MM/yyyy (AU)", () => {
    const qif = `!Type:Bank\nD25/12/2026\nT-1.00\nPP\n^`;
    expect(parseQIF(qif)[0].date).toBe("2026-12-25");
  });

  it("accepts dd-MM-yyyy", () => {
    const qif = `!Type:Bank\nD25-12-2026\nT-1.00\nPP\n^`;
    expect(parseQIF(qif)[0].date).toBe("2026-12-25");
  });

  it("accepts yyyy-MM-dd", () => {
    const qif = `!Type:Bank\nD2026-12-25\nT-1.00\nPP\n^`;
    expect(parseQIF(qif)[0].date).toBe("2026-12-25");
  });
});

describe("parseQIF — duplicate-row disambiguation", () => {
  it("two identical-looking rows hash differently via tuple-occurrence", () => {
    const qif = `!Type:Bank
D01/01/2026
T-5.00
PCoffee
^
D01/01/2026
T-5.00
PCoffee
^`;
    const rows = parseQIF(qif);
    expect(rows).toHaveLength(2);
    expect(rows[0].importHash).not.toBe(rows[1].importHash);
    expect(rows[0].rawId).not.toBe(rows[1].rawId);
  });
});

describe("parseQIF — edge cases", () => {
  it("returns empty for empty input", () => {
    expect(parseQIF("")).toEqual([]);
  });

  it("skips a transaction missing date or amount", () => {
    const qif = `!Type:Bank
PNo date
^
D01/01/2026
PNo amount
^
D01/01/2026
T-1.00
PFull row
^`;
    const rows = parseQIF(qif);
    expect(rows).toHaveLength(1);
    expect(rows[0].payee).toBe("Full row");
  });

  it("handles trailing whitespace and CRLF line endings", () => {
    const qif = "!Type:Bank\r\nD01/01/2026  \r\nT-1.00\r\nPP\r\n^\r\n";
    expect(parseQIF(qif)).toHaveLength(1);
  });
});
