-- Replace the fixed `super_self_label` / `super_partner_label` pair
-- with a JSON column that stores an ordered list of N people. Each
-- entry is `{ key, label }` where `key` is the stable identifier
-- (matches `superannuation_snapshots.person`) and `label` is the
-- display name. Migration backfill is lazy — `loadSuperPeople()`
-- derives the initial list from existing snapshots + the old label
-- columns if `super_people` is NULL. Old label columns are kept for
-- one release as a fallback during reads; they'll be dropped in a
-- later cleanup.
ALTER TABLE app_settings ADD COLUMN super_people TEXT;
