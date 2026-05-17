-- Per-ticker news cache for the investments "Recent announcements"
-- panel. Yahoo Finance's search endpoint returns ~10 recent news
-- items per query; we fetch on demand, dedup against this table,
-- and only re-fetch from Yahoo when the last fetch for the symbol
-- is older than NEWS_TTL_HOURS (currently 24h, defined in the
-- /api/investments/[id]/news handler).
--
-- The (symbol, uuid) unique constraint dedups items that show up
-- across multiple fetches. Symbol is stored uppercased and with the
-- Yahoo exchange suffix preserved (e.g. CBA.AX) so we don't
-- conflate two listings of the same ticker on different venues.
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

CREATE UNIQUE INDEX investment_news_symbol_uuid_idx
  ON investment_news (symbol, uuid);

-- For "what's the most recent fetch on this symbol" — drives the
-- cache-staleness check.
CREATE INDEX investment_news_symbol_fetched_at_idx
  ON investment_news (symbol, fetched_at DESC);
