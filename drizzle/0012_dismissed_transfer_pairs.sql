-- Remember dismissed transfer-pair suggestions.
--
-- Before this migration, dismissing a suggested transfer pair just
-- deleted the row from `transfer_suggestions`. The matcher's next
-- run (every unlock, every import, every manual re-scan) then re-
-- discovered the same pair and re-inserted it via
-- `onConflictDoNothing` — the conflict guard is keyed on
-- (transaction_id, candidate_id), so a freshly-deleted row doesn't
-- trigger it, and the suggestion came back from the dead.
--
-- This table is the sticky "no, never suggest this pair again"
-- signal the matcher checks before inserting. The pair is stored in
-- canonical (transaction_id < candidate_id) order, matching how
-- `pairTransfersInWindow` already orders its candidate pairs, so the
-- skip lookup is a single primary-key probe.
CREATE TABLE dismissed_transfer_pairs (
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  candidate_id   TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  dismissed_at   INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, candidate_id)
);
--> statement-breakpoint
-- Lookup by candidate too — when the matcher iterates the second
-- half of a pair we'll search by candidate_id, not just
-- transaction_id.
CREATE INDEX dismissed_transfer_pairs_candidate_idx
  ON dismissed_transfer_pairs(candidate_id);
