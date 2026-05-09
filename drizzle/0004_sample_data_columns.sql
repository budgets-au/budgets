-- Add `is_sample` boolean to the four tables that the demo-data seeder
-- populates, plus a `sample_data_seeded` boolean on the singleton
-- app_settings row. The seeder in src/db/index.ts gates on the latter
-- so it runs at most once per DB lifetime; the Settings UI can wipe
-- everything tagged is_sample = 1 with one click while keeping
-- system categories (already tagged is_system) untouched.
--
-- Defaults are 0 so existing user data on existing DBs is correctly
-- treated as not-sample after the column is added.

ALTER TABLE accounts ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE transactions ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE scheduled_transactions ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE payee_rules ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE app_settings ADD COLUMN sample_data_seeded INTEGER NOT NULL DEFAULT 0;
