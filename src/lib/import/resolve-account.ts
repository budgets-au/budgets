import { db } from "@/db";
import { accountAliases, accounts } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export interface ResolverAccount {
  id: string;
  name: string;
  accountNumberLast4: string | null;
}

/** Source of truth for "which app-account does this row belong to?"
 *
 * Three levels, in order:
 *   1. account_aliases match — explicit mapping learned previously.
 *   2. accounts.account_number_last4 — first match wins (rare, but covers
 *      cases where the user set the last-4 manually).
 *   3. heuristic existing-record match — when the row's date+amount maps
 *      to a real DB transaction, we infer the bank-id belongs to that
 *      transaction's account. The caller can then optionally persist
 *      this as a new alias via `learnAccountAlias`.
 *
 * Returns null when none of the layers produce a match — caller falls
 * back to the user-picked target account or surfaces a warning. */
export async function resolveAccountByAlias(
  aliasKind: string,
  aliasValue: string,
): Promise<string | null> {
  const [row] = await db
    .select({ accountId: accountAliases.accountId })
    .from(accountAliases)
    .where(
      and(eq(accountAliases.aliasKind, aliasKind), eq(accountAliases.aliasValue, aliasValue)),
    )
    .limit(1);
  return row?.accountId ?? null;
}

export async function resolveAccountByLast4(last4: string): Promise<string | null> {
  // The "Bank Account" column we get from Westpac is a full account number
  // ("037081128637") whereas our accounts.account_number_last4 only stores
  // the last 4 digits. Trim before matching so longer bank IDs still find
  // a hit.
  const trimmed = last4.replace(/\s+/g, "").slice(-4);
  if (!trimmed) return null;
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.accountNumberLast4, trimmed))
    .limit(1);
  return row?.id ?? null;
}

/** Learn a (kind, value) → accountId mapping. Idempotent — repeats for
 * the same (kind, value) on the same accountId no-op; conflicting values
 * (same kind+value already pointing elsewhere) are not overwritten so a
 * single resolve mistake doesn't lock in. Caller decides when to learn. */
export async function learnAccountAlias(
  aliasKind: string,
  aliasValue: string,
  accountId: string,
): Promise<boolean> {
  // .returning() so callers can distinguish "first time we saw this
  // alias" from "already learned, no-op". Used by commit-batched to
  // report the truthful `aliasesLearned` count rather than the
  // input-row count.
  const inserted = await db
    .insert(accountAliases)
    .values({ accountId, aliasKind, aliasValue })
    .onConflictDoNothing({ target: [accountAliases.aliasKind, accountAliases.aliasValue] })
    .returning({ id: accountAliases.id });
  return inserted.length > 0;
}
