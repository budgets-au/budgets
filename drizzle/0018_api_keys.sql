-- Long-lived bearer tokens for programmatic access. Presented via the
-- `Authorization: Bearer bk_<...>` header. `key_hash` stores the SHA-256
-- digest of the plaintext key; the plaintext itself is shown ONCE at
-- creation and never round-tripped through the DB again. Row deletion
-- is the revoke operation.
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
--> statement-breakpoint
CREATE UNIQUE INDEX api_keys_key_hash_idx ON api_keys (key_hash);
