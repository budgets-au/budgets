// Config + arithmetic for the "Account group" dashboard widget: a user-picked
// set of accounts whose balances are combined into one figure (e.g. savings
// minus what's owed). Kept free of React so it can be unit-tested.

export type Sign = 1 | -1;

export interface AccountGroupMember {
  id: string;
  /** +1 adds the balance as stored, -1 subtracts it. Credit and loan
   *  balances are already negative, so "savings − debts" is all +1. */
  sign: Sign;
}

export interface AccountGroupConfig {
  title: string;
  members: AccountGroupMember[];
}

/** Read the widget's opaque layout config defensively: unknown shapes,
 *  duplicate ids and bad signs are dropped rather than trusted. */
export function parseAccountGroupConfig(config: Record<string, unknown> | undefined): AccountGroupConfig {
  const title = typeof config?.title === "string" ? config.title.slice(0, 60) : "";
  const raw = Array.isArray(config?.members) ? config.members : [];
  const seen = new Set<string>();
  const members: AccountGroupMember[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const id = (m as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    members.push({ id, sign: (m as { sign?: unknown }).sign === -1 ? -1 : 1 });
  }
  return { title, members };
}

export interface GroupAccount {
  id: string;
  name: string;
  currentBalance: string;
  isArchived?: boolean;
}

export interface AccountGroupRow {
  id: string;
  name: string;
  balance: number;
  sign: Sign;
  contribution: number;
  isArchived: boolean;
}

export interface AccountGroupResult {
  total: number;
  rows: AccountGroupRow[];
  /** Selected ids that no longer match an account (deleted since). */
  missing: number;
}

export function computeAccountGroup(
  accounts: GroupAccount[],
  members: AccountGroupMember[],
): AccountGroupResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const rows: AccountGroupRow[] = [];
  let missing = 0;
  for (const m of members) {
    const a = byId.get(m.id);
    if (!a) {
      missing++;
      continue;
    }
    const parsed = parseFloat(a.currentBalance);
    const balance = Number.isFinite(parsed) ? parsed : 0;
    rows.push({
      id: a.id,
      name: a.name,
      balance,
      sign: m.sign,
      contribution: m.sign * balance,
      isArchived: !!a.isArchived,
    });
  }
  // Sum in cents to avoid float drift across many accounts.
  const cents = rows.reduce((s, r) => s + Math.round(r.contribution * 100), 0);
  return { total: cents / 100, rows, missing };
}

/** Toggle an account in or out of the group, preserving order. */
export function toggleMember(members: AccountGroupMember[], id: string): AccountGroupMember[] {
  return members.some((m) => m.id === id)
    ? members.filter((m) => m.id !== id)
    : [...members, { id, sign: 1 }];
}

export function flipSign(members: AccountGroupMember[], id: string): AccountGroupMember[] {
  return members.map((m) => (m.id === id ? { ...m, sign: m.sign === 1 ? -1 : 1 } : m));
}
