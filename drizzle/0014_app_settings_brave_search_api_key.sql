-- Brave Search subscription token for the supplemental web-source
-- announcements on the investment-detail panel. Settable from
-- Settings → General. The `BRAVE_SEARCH_API_KEY` env var takes
-- precedence when both are set; the DB value is the fallback for
-- household installs without container-env access.
ALTER TABLE app_settings ADD COLUMN brave_search_api_key TEXT;
