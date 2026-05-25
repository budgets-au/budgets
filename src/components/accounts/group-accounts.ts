import type { Account } from "@/db/schema";

/** Grouping spec for the /accounts list — assets first, then
 *  liabilities. Anything outside the canonical set falls into
 *  the "Other" bucket built by `groupAccounts` so unfamiliar
 *  imported types stay visible rather than vanishing. */
export interface GroupSpec {
  key: string;
  label: string;
  types: ReadonlyArray<string>;
}

export const GROUPS: ReadonlyArray<GroupSpec> = [
  { key: "assets", label: "Assets", types: ["checking", "savings", "cash", "investment", "super"] },
  { key: "liabilities", label: "Liabilities", types: ["credit", "loan"] },
];

export const TYPE_LABEL: Record<string, string> = {
  checking: "Everyday / Checking",
  savings: "Savings",
  cash: "Cash",
  investment: "Investment",
  super: "Super",
  credit: "Credit Card",
  loan: "Loan / Mortgage",
};

export interface GroupedAccounts {
  groups: Array<GroupSpec & { accounts: Account[]; subtotal: number }>;
  /** Catch-all for unrecognised types; null when every account fits
   *  in a canonical group. */
  other: { accounts: Account[]; subtotal: number } | null;
  /** Sum of every group's subtotal — credit/loan balances are
   *  already negative in the DB, so this is straightforward
   *  arithmetic and renders as the "Net worth" line. */
  net: number;
}

export function groupAccounts(accounts: Account[]): GroupedAccounts {
  const claimed = new Set<string>();
  const groups = GROUPS.map((g) => {
    const rows = accounts.filter((a) => g.types.includes(a.type));
    rows.forEach((a) => claimed.add(a.id));
    const subtotal = rows.reduce((sum, a) => sum + parseFloat(a.currentBalance), 0);
    return { ...g, accounts: rows, subtotal };
  });
  const otherRows = accounts.filter((a) => !claimed.has(a.id));
  const other =
    otherRows.length > 0
      ? {
          accounts: otherRows,
          subtotal: otherRows.reduce((sum, a) => sum + parseFloat(a.currentBalance), 0),
        }
      : null;
  const net =
    groups.reduce((sum, g) => sum + g.subtotal, 0) + (other?.subtotal ?? 0);
  return { groups, other, net };
}
