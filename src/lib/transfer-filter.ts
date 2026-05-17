import { sql } from "drizzle-orm";

/**
 * Canonical SQL predicate for "is this transaction a transfer?"
 *
 * **A transaction is a transfer iff it has a `transfer_pair_id`.**
 * The pair-id is the sole source of truth. Both legs of any transfer —
 * auto-paired, manually-paired, or synthetic-leg-paired (where the
 * other side lives in an isExternal=true placeholder account) — carry
 * a non-null `transfer_pair_id` after the 0009/0010 migration window.
 *
 * Historical signals that have been retired:
 *   - `transactions.is_transfer` boolean — dropped in migration 0010;
 *     it was redundant with `transfer_pair_id IS NOT NULL`.
 *   - `categories.transfer_kind` enum — kept in the schema as a UI
 *     label hint, but no longer used as a query filter for transfer-
 *     ness. Internal vs external classification is now derived from
 *     the paired accounts' types (`isPoolAsset(both)` → internal).
 *
 * The aliases (`t.`) match the conventional join layout every
 * call-site already uses. If you join with a different alias, use
 * the `mkIsTransferRow(txnAlias)` factory.
 *
 * NOTE — this is NOT the same as the cashflow report's `hideTransfers`
 * filter, which is intentionally narrower (only INTERNAL transfers are
 * hidden so external loan/CC payments remain visible as real cashflow).
 * Cashflow uses `c.transfer_kind != 'internal'` directly; don't
 * replace it with this helper.
 */
export const isTransferRow = sql<boolean>`(${sql.raw("t")}.transfer_pair_id IS NOT NULL)`;

/** Factory for queries that use a non-standard txn alias. */
export function mkIsTransferRow(txnAlias: string) {
  return sql<boolean>`(${sql.raw(txnAlias)}.transfer_pair_id IS NOT NULL)`;
}
