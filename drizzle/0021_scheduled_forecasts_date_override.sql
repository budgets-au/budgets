-- Extend the per-occurrence override table to support a date shift
-- alongside the existing amount shift. The unique key (scheduled_id,
-- occurrence_date) still refers to the rule-derived date so the
-- override row can be looked up from the standard recurrence walk;
-- when new_date is present the projection emits the event at
-- new_date instead.
--
-- amount was NOT NULL before this migration — a date-only override
-- (shift the schedule to a different day without changing the
-- amount) wasn't expressible. SQLite doesn't support ALTER COLUMN
-- so the column relaxation happens via a table rebuild. Existing
-- rows are copied verbatim; new_date starts NULL for every legacy
-- amount override.
CREATE TABLE scheduled_forecasts_new (
  id TEXT PRIMARY KEY NOT NULL,
  scheduled_id TEXT NOT NULL REFERENCES scheduled_transactions(id) ON DELETE CASCADE,
  occurrence_date TEXT NOT NULL,
  amount TEXT,
  new_date TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT INTO scheduled_forecasts_new (id, scheduled_id, occurrence_date, amount, new_date, created_at, updated_at)
  SELECT id, scheduled_id, occurrence_date, amount, NULL, created_at, updated_at
  FROM scheduled_forecasts;
--> statement-breakpoint
DROP TABLE scheduled_forecasts;
--> statement-breakpoint
ALTER TABLE scheduled_forecasts_new RENAME TO scheduled_forecasts;
--> statement-breakpoint
CREATE UNIQUE INDEX scheduled_forecasts_unique_idx ON scheduled_forecasts(scheduled_id, occurrence_date);
--> statement-breakpoint
CREATE INDEX scheduled_forecasts_scheduled_idx ON scheduled_forecasts(scheduled_id);
