-- Adds the singleton scheduled-backup config (driven by the new
-- `src/lib/backup/scheduler.ts` module). Stored on the existing
-- `app_settings` row alongside `tax_config`. JSON-encoded so we can add
-- fields later without further migrations.
--
-- Default: scheduler off, daily cadence, retain 7 — the user opts in
-- via Settings → Backup.

ALTER TABLE app_settings ADD COLUMN backup_schedule TEXT;
--> statement-breakpoint
UPDATE app_settings
   SET backup_schedule = json_object(
     'enabled', json('false'),
     'intervalDays', 7,
     'retain', 7,
     'lastRunAt', NULL
   )
 WHERE id = 1;
