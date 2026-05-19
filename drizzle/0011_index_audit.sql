-- Index audit fill — three high-signal additions surfaced by a
-- query-vs-index review in 0.168.0:
--
--   1. payee_rules(normalized_payee)
--      Every CSV import runs `batchLookupPayeeRules()` which does
--      `WHERE normalized_payee IN (?, ?, …)` across dozens of distinct
--      payees in a single batch. Without an index, each lookup is a
--      full table scan; with one, it's a B-tree probe per payee. Most
--      user-visible win — import latency is felt directly.
--
--   2. scheduled_transactions(is_active)
--      The dashboard upcoming-schedules query and several reports
--      filter `WHERE is_active = 1`. Tiny table today, but the filter
--      runs on every dashboard load and there's no reason not to index it.
--
--   3. transactions(transfer_pair_id, date)
--      `pairTransfersInWindow()` does a self-join across the
--      transactions table with predicates on `transfer_pair_id IS NULL`
--      plus a date-window join. Currently O(n²) over the unpaired
--      subset; the composite prunes both passes to the small unpaired
--      set in the right date window.
--
-- All three are CREATE INDEX IF NOT EXISTS so re-running this migration
-- on a DB that somehow already has them (e.g. hand-applied via the
-- maintenance UI later) is a no-op.

CREATE INDEX IF NOT EXISTS `payee_rules_normalized_payee_idx`
  ON `payee_rules` (`normalized_payee`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scheduled_transactions_is_active_idx`
  ON `scheduled_transactions` (`is_active`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `transactions_transfer_pair_date_idx`
  ON `transactions` (`transfer_pair_id`, `date`);
