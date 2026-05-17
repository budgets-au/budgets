-- Per-ticker news cache for the investments "Recent announcements"
-- panel. Yahoo Finance's search endpoint returns ~10 recent news
-- items per query; we fetch on demand, dedup against this table,
-- and only re-fetch from Yahoo when the last fetch for the symbol
-- is older than NEWS_TTL_HOURS (currently 24h, defined in the
-- /api/investments/[id]/news handler).
CREATE TABLE investment_news (
  id           TEXT PRIMARY KEY,
  symbol       TEXT NOT NULL,
  uuid         TEXT NOT NULL,
  title        TEXT NOT NULL,
  publisher    TEXT,
  link         TEXT NOT NULL,
  published_at INTEGER,
  thumbnail    TEXT,
  fetched_at   INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX investment_news_symbol_uuid_idx ON investment_news (symbol, uuid);
--> statement-breakpoint
CREATE INDEX investment_news_symbol_fetched_at_idx ON investment_news (symbol, fetched_at DESC);
