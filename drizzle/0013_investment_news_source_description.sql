-- Investment-news now carries rows from both Yahoo Finance and Brave
-- Search. Pre-0.222 every row was Yahoo, so the column defaults to
-- 'yahoo' and existing rows stay correct. Description is Brave-only
-- (Yahoo never populated a snippet); Yahoo rows leave it null.
ALTER TABLE investment_news ADD COLUMN source TEXT NOT NULL DEFAULT 'yahoo';
--> statement-breakpoint
ALTER TABLE investment_news ADD COLUMN description TEXT;
