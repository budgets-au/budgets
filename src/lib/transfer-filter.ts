import { sql } from "drizzle-orm";

/**
 * Canonical SQL predicates for "is this transaction a transfer?"
 *
 * Two signals exist in the schema:
 *
 *   - `categories.transfer_kind` enum (`'none' | 'internal' | 'external'`):
 *     set on the category itself. Auto-pairing in
 *     `src/lib/transfer-match.ts` reads it and uses it as a scoring
 *     signal, but never writes it. The category-manager UI writes it.
 *
 *   - `transactions.is_transfer` boolean flag: set by the auto-matcher
 *     when it pairs two rows, and by `manualPair()` when the user
 *     manually links via the "Link as transfer" UI. NEVER cleared
 *     except by `manualUnpair()`.
 *
 * Both signals are needed because they're written by different code
 * paths and aren't kept in sync:
 *
 *   - Auto-pair: writes `is_transfer=1` always; writes `category_id`
 *     only when crossing a loan/credit boundary AND the source side
 *     was uncategorised.
 *   - Manual-pair: writes `is_transfer=1`; never touches category.
 *   - Legacy categorise-without-pair: a category with transfer_kind
 *     ∈ {internal, external} but no matched counterpart → flag=0,
 *     kind=internal/external.
 *
 * The canonical "is this row a transfer" predicate ORs the two signals
 * together. This is what the Accounts and Flow reports use to surface
 * transfer breakdowns, and what the `/api/transactions` endpoint's
 * `transferPairAccountId` drill-through requires to match cells in the
 * Accounts report.
 *
 * NOTE — this is NOT the same as the cashflow report's `hideTransfers`
 * filter, which is narrower (`transfer_kind != 'internal'`, internal-
 * only). External transfers like loan payments ARE real cashflow, so
 * they're kept visible in cashflow totals even when hideTransfers is
 * on. Don't replace cashflow's filter with this helper.
 *
 * The aliases (`c.`, `t.`) match the conventional join layout every
 * call-site already uses. If you join with different aliases, pass
 * them via the factory.
 */
export const isTransferRow = sql<boolean>`(
  COALESCE(c.transfer_kind, 'none') IN ('internal','external')
  OR COALESCE(t.is_transfer, 0) = 1
)`;

/** Factory for queries that use non-standard join aliases. */
export function mkIsTransferRow(
  txnAlias: string,
  catAlias: string,
) {
  return sql<boolean>`(
    COALESCE(${sql.raw(catAlias)}.transfer_kind, 'none') IN ('internal','external')
    OR COALESCE(${sql.raw(txnAlias)}.is_transfer, 0) = 1
  )`;
}
