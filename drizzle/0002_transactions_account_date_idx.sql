-- Composite index on (account_id, date) — used by /api/transactions and
-- /api/transactions/count whenever the user picks an account and a date
-- range. The single-column accountId index alone forces the engine to
-- filter by date in-engine (or sort to find the bounds); this lets it
-- seek straight to the (account, date_from) entry and walk in order.

CREATE INDEX IF NOT EXISTS transactions_account_date_idx
  ON transactions(account_id, date);
