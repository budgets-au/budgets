-- Add `display_prefs` JSON column to the singleton app_settings row.
-- This is where the unified, DB-backed client display preferences
-- live (transactions-list page size + notes/linked panel toggles,
-- calendar month/week mode, report tab toggles, etc.) — replacing
-- the per-browser localStorage blob that used to drift between
-- devices. The column is nullable; the API route fills it via the
-- existing app_settings.id=1 singleton row.

ALTER TABLE app_settings ADD COLUMN display_prefs TEXT;
