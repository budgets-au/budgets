-- Free-form notes on scheduled transactions + budgets.
--
-- Distinct from `description` (which is the payee-fallback display
-- string). `notes` is the operator's own annotation — gotchas,
-- explanations of why the schedule exists, things to remember when
-- the matcher fires. Surfaced in the list view via a popover icon
-- whose colour indicates whether content is present.
ALTER TABLE scheduled_transactions ADD COLUMN notes TEXT;
