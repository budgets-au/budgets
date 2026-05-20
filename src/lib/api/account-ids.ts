import { sql, type SQL } from "drizzle-orm";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical UUID shape test. Use anywhere a raw string from
 *  `searchParams` or a URL segment needs to be confirmed as a
 *  UUID before being bound into an SQL fragment. */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

/** Parses the `?accountIds=<csv>` querystring used by every
 *  report API route. Returns only canonical UUIDs — anything
 *  malformed is silently dropped so a stray comma or empty
 *  segment can't sneak through to the SQL fragments. */
export function parseAccountIds(searchParams: URLSearchParams): string[] {
  const raw = searchParams.get("accountIds");
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((id) => UUID_RE.test(id));
}

/** Build the two SQL fragments the report routes use to filter
 *  transactions by account.
 *
 *  - `accountFilter` uses the bare `account_id` column (single-
 *    table query).
 *  - `accountFilterT` uses `t.account_id` (joined subquery).
 *
 *  When `accountIds` is empty, both fragments fall back to
 *  "non-archived accounts only" — archived accounts are hidden
 *  in the UI and shouldn't be silently included by an "All
 *  accounts" selection. Each id is bound as its own parameter
 *  via `sql.join` (no string concat).
 *
 *  Returns the id-list `SQL` too, in case the caller needs it
 *  directly for a non-transactions query. */
export function accountIdSql(
  accountIds: string[],
): { idList: SQL; accountFilter: SQL; accountFilterT: SQL } {
  const idList = sql.join(
    accountIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const accountFilter =
    accountIds.length > 0
      ? sql`AND account_id IN (${idList})`
      : sql`AND account_id IN (SELECT id FROM accounts WHERE is_archived = 0)`;
  const accountFilterT =
    accountIds.length > 0
      ? sql`AND t.account_id IN (${idList})`
      : sql`AND t.account_id IN (SELECT id FROM accounts WHERE is_archived = 0)`;
  return { idList, accountFilter, accountFilterT };
}
