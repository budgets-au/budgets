-- Replace the paired booleans `is_transfer` + `is_payment` on categories
-- with a single enum `transfer_kind` carrying three states:
--   'none'     — regular income/expense (default)
--   'internal' — pure asset-to-asset moves (Checking → Savings). Excluded
--                from cashflow & report rollups; only affects balance.
--   'external' — payments to an untracked debt (e.g. external loan / CC).
--                Counted as a normal expense in cashflow.
--
-- The two old flags were overlapping and not mutually exclusive in the UI;
-- consumers were diverging on which "linked-class" predicate to use. The
-- enum collapses those into one semantic axis.
--
-- Migration is conservative: rows that had both flags set collapse to
-- 'internal' (the stricter, hides-from-cashflow option).
--
-- The old columns are LEFT IN PLACE so existing reads don't crash mid-
-- deploy; the application schema in src/db/schema.ts no longer references
-- them. A future migration can DROP them once we're confident no caller
-- remains.

ALTER TABLE categories ADD COLUMN transfer_kind TEXT NOT NULL DEFAULT 'none';
--> statement-breakpoint
UPDATE categories SET transfer_kind = 'internal' WHERE is_transfer = 1;
--> statement-breakpoint
UPDATE categories SET transfer_kind = 'external' WHERE is_payment = 1 AND is_transfer = 0;
