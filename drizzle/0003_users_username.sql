-- Rename `users.email` to `users.username`. The app never used email
-- semantically — it was just the login identifier — and supporting
-- email-shape values surprised users who don't have a household
-- mail server. The rename preserves the existing unique constraint
-- and any data already in the column. The first-unlock auto-seed
-- (in src/db/index.ts) inserts admin/admin when the table is empty.

ALTER TABLE users RENAME COLUMN email TO username;
