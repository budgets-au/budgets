# PIT recovery snapshots

Database snapshots taken before bulk changes. Pair with the matching git tag
so you can reproduce the exact state of code + data.

## Layout

- `pit_YYYYMMDD_HHMMSS.dump` — `pg_dump --format=custom` (compressed,
  parallel-restore capable)
- `pit_YYYYMMDD_HHMMSS.sql` — same data as plain SQL (human-readable, for diff
  + grep-based forensic checks)
- Each pair is paired with a git tag of the form `pre-<descriptor>-YYYY-MM-DD`
  pointing at the commit that was current when the snapshot was taken.

## Restoring a snapshot

```bash
# Stop the app first (writes during restore corrupt the snapshot)
docker compose stop app

# Wipe + reload from a custom-format dump (preferred — handles dependencies)
PGPASSWORD=secret pg_restore -h localhost -U budgets -d budgets \
  --clean --if-exists --no-owner --no-privileges \
  /projects/budgets/backups/pit_YYYYMMDD_HHMMSS.dump

# Code: roll the working tree back to the matching tag
git checkout pre-<descriptor>-YYYY-MM-DD

# Restart
docker compose start app
```

## Current snapshots

| Snapshot | Git tag | Reason |
|---|---|---|
| `pit_20260506_071009` | `pre-cleanup-2026-05-06` | Before the post-review bulk cleanup pass (data correctness, tests, UI fixes) |
| `pit_20260506_103228` | `pre-bugfixes-2026-05-06` | Before the 21-fix sprint following the second review round |
| `pit_20260506_110327` | `post-bugfixes-2026-05-06` | After the 21-fix sprint — all changes verified, 107 tests passing |
| `pit_20260508_064138` | `pre-sqlite-trial-2026-05-08` | Before the SQLite-alongside-Postgres dual-driver work begins |
