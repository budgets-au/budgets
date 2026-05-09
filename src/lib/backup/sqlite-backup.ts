/**
 * SQLite-native backup helpers — replaces the Postgres-era JSON-dump
 * stack. A backup is just a copy of the live SQLCipher file, produced
 * via better-sqlite3's online-backup API so reads/writes can continue
 * during the copy. The output file inherits the source's encryption
 * key, which means restoring after a rekey requires the OLD passphrase
 * (see /api/backup/restore).
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import Database from "@signalapp/better-sqlite3";
import { db, getClient, livePath, lock } from "@/db";
import { appSettings, type BackupSchedule } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export type BackupType = "manual" | "scheduled" | "pre-restore";

export interface BackupEntry {
  filename: string;
  type: BackupType;
  size: number;
  /** ISO timestamp from mtime — the source of truth for ordering. */
  mtime: string;
}

/** Where backups live. Defaults to `<dirname(SQLITE_PATH)>/backups/`
 * so the same volume mount that holds the live DB also holds the
 * snapshots. Override via BACKUP_DIR for off-volume storage. */
export function backupDir(): string {
  return resolve(process.env.BACKUP_DIR ?? join(dirname(livePath), "backups"));
}

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
}

/** Cache window for {@link diskUsage}. The settings page polls
 * /api/backup whenever the user opens it, and free space barely
 * moves between polls — a 30s window collapses many syscalls into
 * one without making the displayed % stale enough to mislead. */
export const DISK_USAGE_CACHE_MS = 30_000;

interface DiskUsageCache {
  at: number;
  value: DiskUsage;
}

let diskUsageCache: DiskUsageCache | null = null;

/** Test seam — clears the cached statfs result so each test
 * exercises the underlying syscall path. Not exported through any
 * production caller. */
export function __resetDiskUsageCache(): void {
  diskUsageCache = null;
}

/** statfs of the backup volume so the UI can show how much room
 * is left before the next snapshot risks running the disk dry.
 * `bavail` rather than `bfree` — the latter includes blocks reserved
 * for root that an unprivileged backup write can't actually touch.
 * Result is cached for {@link DISK_USAGE_CACHE_MS} so rapid polling
 * doesn't spam syscalls. */
export async function diskUsage(): Promise<DiskUsage> {
  const now = Date.now();
  if (diskUsageCache && now - diskUsageCache.at < DISK_USAGE_CACHE_MS) {
    return diskUsageCache.value;
  }
  const dir = backupDir();
  const target = existsSync(dir) ? dir : dirname(dir);
  const s = await statfs(target);
  const value: DiskUsage = {
    totalBytes: s.blocks * s.bsize,
    freeBytes: s.bavail * s.bsize,
  };
  diskUsageCache = { at: now, value };
  return value;
}

const FILENAME_RE = /^budgets_(manual|scheduled|pre-restore)_[0-9TZ.\-]+\.sqlite$/;

/** Defence-in-depth against path traversal — every API route that
 * accepts a filename runs it through this guard. Also rejects anything
 * that doesn't look like our own output, so a stray random file in
 * the backups dir can't be served or deleted by accident. */
export function isSafeBackupFilename(name: string): boolean {
  if (basename(name) !== name) return false;
  return FILENAME_RE.test(name);
}

function timestampForFilename(): string {
  return new Date().toISOString().replace(/[:]/g, "-");
}

/** List backups newest-first. Filenames that don't match our pattern
 * are skipped so a hand-placed file in the dir doesn't show up in the
 * UI as something the user can delete or restore. */
export function listBackups(): BackupEntry[] {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  const out: BackupEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!isSafeBackupFilename(name)) continue;
    const m = name.match(FILENAME_RE);
    if (!m) continue;
    const stat = statSync(join(dir, name));
    out.push({
      filename: name,
      type: m[1] as BackupType,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    });
  }
  out.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return out;
}

/** Take a backup of the live DB. Uses `VACUUM INTO` — the
 * SQLCipher-compatible path. (The signalapp fork's `db.backup()`
 * online-backup API is disabled on encrypted databases.) The output
 * is a single, fully-formed SQLCipher file keyed with the same
 * passphrase as the source; no WAL/SHM siblings are produced.
 *
 * After a successful backup, retention is enforced for the
 * `scheduled` type only — manual + pre-restore backups are sticky.
 */
export async function takeBackup(type: BackupType): Promise<BackupEntry> {
  const client = getClient();
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });
  const filename = `budgets_${type}_${timestampForFilename()}.sqlite`;
  const dest = join(dir, filename);
  // VACUUM INTO doesn't accept bound parameters, so the path is
  // interpolated. The path is constructed from a fixed `backupDir()`
  // root and a regex-validated filename, so injection isn't reachable
  // — but escape single quotes anyway as belt-and-braces.
  client.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  if (type === "scheduled") sweepRetention();
  const stat = statSync(dest);
  return {
    filename,
    type,
    size: stat.size,
    mtime: stat.mtime.toISOString(),
  };
}

/** Delete a backup file by name. Throws if the name fails the safety
 * guard or the file isn't there. Manual + pre-restore deletions are
 * fine (the user explicitly asked); the scheduler avoids deleting
 * those during retention sweeps. */
export function deleteBackup(filename: string): void {
  if (!isSafeBackupFilename(filename)) {
    throw new Error("Invalid backup filename");
  }
  const path = join(backupDir(), filename);
  if (!existsSync(path)) {
    throw new Error("Backup not found");
  }
  rmSync(path);
}

/** Drop scheduled backups beyond `retain` count. Called after each
 * scheduled backup completes; a no-op for manual + pre-restore types.
 * Reads the current retention setting from app_settings on every call
 * so config changes apply on the next sweep without restarting. */
export function sweepRetention(): void {
  const cfg = readSchedule();
  const retain = Math.max(0, Math.floor(cfg.retain ?? 0));
  const scheduledNewestFirst = listBackups().filter((b) => b.type === "scheduled");
  if (scheduledNewestFirst.length <= retain) return;
  for (const stale of scheduledNewestFirst.slice(retain)) {
    try {
      rmSync(join(backupDir(), stale.filename));
    } catch {
      // Sweep is best-effort — a locked file or permission glitch
      // shouldn't propagate up and abort the schedule loop.
    }
  }
}

const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: false,
  intervalDays: 7,
  retain: 7,
  lastRunAt: null,
};

/** Pull the schedule config from app_settings.id=1, with defaults for
 * a fresh install. Reads through the unlocked `db` proxy — callers
 * must run after the DB is unlocked (the scheduler waits for that).
 *
 * Falls back to defaults if the `backup_schedule` column doesn't
 * exist yet (the migration hasn't applied) so the backup list page
 * still loads. */
export function readSchedule(): BackupSchedule {
  try {
    // .all() forces the synchronous better-sqlite3 result — drizzle's
    // typed builder otherwise stays a thenable and TS won't let us
    // destructure it directly.
    const rows = db
      .select({ schedule: appSettings.backupSchedule })
      .from(appSettings)
      .where(eq(appSettings.id, 1))
      .limit(1)
      .all();
    return rows[0]?.schedule ?? DEFAULT_SCHEDULE;
  } catch (e) {
    console.error("[backup] readSchedule failed, using defaults:", e);
    return DEFAULT_SCHEDULE;
  }
}

/** Persist a partial schedule update. Merges over the existing config
 * so `lastRunAt` (touched by the scheduler) and the user-edited
 * fields don't clobber each other. */
export function writeSchedule(patch: Partial<BackupSchedule>): BackupSchedule {
  const current = readSchedule();
  const next: BackupSchedule = { ...current, ...patch };
  db.update(appSettings)
    .set({ backupSchedule: next, updatedAt: new Date() })
    .where(eq(appSettings.id, 1))
    .run();
  // If the row didn't exist (very fresh install pre-migration), insert
  // it. The migration covers id=1 so this is belt-and-braces.
  db.run(sql`
    INSERT INTO app_settings (id, backup_schedule)
    SELECT 1, ${JSON.stringify(next)}
    WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE id = 1)
  `);
  return next;
}

/**
 * Verify a backup file can be opened with the supplied passphrase.
 * Uses a fresh, isolated connection — never touches the live one.
 * Returns the size of the file on success or null on a wrong-key /
 * corrupt / missing-file failure. The caller decides what error
 * message to show (we don't surface raw SQLCipher errors because
 * "file is not a database" leaks little but reads alarmingly).
 */
export function verifyBackup(
  path: string,
  passphrase: string,
): { ok: true; size: number } | { ok: false; error: string } {
  if (!existsSync(path)) return { ok: false, error: "Backup file not found" };
  let probe: ReturnType<typeof Database> | undefined;
  try {
    probe = new Database(path);
    probe.pragma(`key = '${passphrase.replace(/'/g, "''")}'`);
    probe.pragma("cipher_compatibility = 4");
    probe.prepare("SELECT count(*) FROM sqlite_master").get();
    return { ok: true, size: statSync(path).size };
  } catch {
    return { ok: false, error: "Wrong passphrase or corrupt backup file." };
  } finally {
    try {
      probe?.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Sanity check that a file looks like a SQLCipher database (random
 * first 16 bytes — plain SQLite would start with "SQLite format 3").
 * Used on uploaded files to bail out before attempting to key them.
 */
export function looksLikeSqlcipher(path: string): boolean {
  if (!existsSync(path)) return false;
  const head = Buffer.alloc(16);
  const fd = openSync(path, "r");
  try {
    readSync(fd, head, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  // Plain SQLite files start with "SQLite format 3\0".
  return head.toString("utf8", 0, 15) !== "SQLite format 3";
}

/**
 * Replace the live DB with an already-validated backup file. Steps:
 *   1. Close the live connection (`lock()`) so no one is mid-read on
 *      the file when we move it.
 *   2. Remove stale WAL/SHM siblings (they'd confuse SQLCipher
 *      on re-open against the new file).
 *   3. Atomic rename of the new file into place. The caller passes us
 *      a path already on the same filesystem so rename is atomic.
 *
 * The caller is responsible for taking the `pre-restore` snapshot
 * BEFORE calling this. After this returns, the next request will
 * trigger the proxy's lock-redirect to /unlock.
 */
export function swapLive(newDbPath: string): void {
  lock();
  // Remove WAL + SHM siblings of the live DB — they belong to the
  // pre-restore connection and will be regenerated when the next
  // unlock opens the new file.
  for (const suffix of ["-wal", "-shm"]) {
    const p = livePath + suffix;
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  renameSync(newDbPath, livePath);
}
