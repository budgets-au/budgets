-- Per-key capability scope. `full` = access to every route the
-- underlying role permits (current behaviour of every existing
-- key). `ops` = restricted to a small allowlist of operational
-- endpoints (see OPS_ALLOWLIST in src/lib/api/route-guards.ts).
-- Additional scopes get added by widening that allowlist —
-- schema stays a single TEXT column.
ALTER TABLE api_keys ADD COLUMN scope TEXT NOT NULL DEFAULT 'full';
