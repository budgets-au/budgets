-- Bank-reported closing balance per account per date.
--
-- Westpac's accounts CSV (and other banks' equivalents) emits one row
-- per (account, date) with that day's "Closing Balance" column. We
-- already extract the earliest row's balance into `accounts.starting_balance`
-- as the historical anchor; this table captures the FULL daily series
-- alongside it so a future "reconciliation" report can compare
-- `starting_balance + Σ tracked amount on/before date` against
-- `bank_balances.balance` and surface drift (= missing or wrong txns).
--
-- UNIQUE(account_id, date) so re-importing the same CSV doesn't
-- duplicate; the commit-side INSERT uses ON CONFLICT DO UPDATE so
-- successive imports refresh the recorded balance for any given day.
-- CASCADE on the FK so deleting (or future-merging) an account cleans
-- up its balance history without leaving orphan rows.
CREATE TABLE bank_balances (
  id          TEXT PRIMARY KEY NOT NULL,
  account_id  TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  balance     TEXT NOT NULL,
  source      TEXT,
  created_at  INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX bank_balances_account_date_unique
  ON bank_balances(account_id, date);
--> statement-breakpoint
CREATE INDEX bank_balances_account_idx
  ON bank_balances(account_id, date);
