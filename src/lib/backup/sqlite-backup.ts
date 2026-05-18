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
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { statfs } from "node:fs/promises";
import { dirname, join, resolve, basename, sep } from "node:path";
import Database from "@signalapp/better-sqlite3";
import { getClient, livePath, lock } from "@/db";
import { type BackupSchedule } from "@/db/schema";
import {
  getActiveProfile,
  readSchedule as readScheduleFromRegistry,
  writeSchedule as writeScheduleToRegistry,
} from "@/lib/db-profiles";

export type BackupType = "manual" | "scheduled" | "pre-restore";

export interface BackupEntry {
  filename: string;
  type: BackupType;
  size: number;
  /** ISO timestamp from mtime — the source of truth for ordering. */
  mtime: string;
  /** User-supplied annotation. Stored in a sidecar JSON file next to
   *  the backup (see `*.meta.json` on disk). Null when no sidecar
   *  exists or the sidecar's notes field is empty. */
  notes: string | null;
}

/** Sidecar metadata schema. Lives alongside the encrypted backup file
 *  as `<backup-filename>.meta.json`; intentionally OUTSIDE the
 *  SQLCipher file so the operator can read notes without the
 *  passphrase + so the format stays forward-extensible. */
interface BackupMeta {
  notes?: string | null;
}

function metaPathFor(backupPath: string): string {
  return `${backupPath}.meta.json`;
}

function readBackupMeta(backupPath: string): BackupMeta {
  const p = metaPathFor(backupPath);
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const notes = (parsed as Record<string, unknown>).notes;
      return {
        notes: typeof notes === "string" && notes.length > 0 ? notes : null,
      };
    }
  } catch {
    // Sidecar corrupt — drop silently. The backup itself is the
    // authoritative artefact; missing/broken notes are merely cosmetic.
  }
  return {};
}

function writeBackupMeta(backupPath: string, meta: BackupMeta): void {
  const p = metaPathFor(backupPath);
  const trimmedNotes = meta.notes?.trim() ?? "";
  if (trimmedNotes.length === 0) {
    // Empty notes → delete the sidecar so an empty annotation doesn't
    // litter the directory or read as "" instead of null on next list.
    if (existsSync(p)) rmSync(p);
    return;
  }
  writeFileSync(p, JSON.stringify({ notes: trimmedNotes }, null, 2));
}

/** Update the notes annotation on a backup by filename. Throws if
 *  the filename fails the safety guard or the backup itself doesn't
 *  exist. Empty / whitespace-only notes delete the sidecar. */
export function setBackupNotes(filename: string, notes: string): void {
  if (!isSafeBackupFilename(filename)) {
    throw new Error("Invalid backup filename");
  }
  const path = join(backupDir(), filename);
  if (!existsSync(path)) {
    throw new Error("Backup not found");
  }
  writeBackupMeta(path, { notes });
}

/** Where backups live. Defaults to `<dirname(SQLITE_PATH)>/backups/`
 * so the same volume mount that holds the live DB also holds the
 * snapshots. Override via BACKUP_DIR for off-volume storage. */
/** Where backups live. Returns a profile-specific subdirectory so
 *  multiple databases' backups don't collide. The base directory is
 *  `BACKUP_DIR` (env override) or `<dirname(activeLivePath)>/backups`;
 *  the active profile's id is appended as a subdir. The legacy
 *  single-DB layout (`<base>/budgets_*.sqlite`) gets migrated into
 *  `<base>/default/` by `migrateLegacyBackups()` on first call. */
export function backupDir(): string {
  const baseRoot = resolve(
    process.env.BACKUP_DIR ?? join(dirname(livePath()), "backups"),
  );
  return join(baseRoot, getActiveProfile().id);
}

/** Like `backupDir()` but for an arbitrary profile id, not just the
 *  active one. Used by the Databases manager when deleting a
 *  non-active profile — its backup subdir has to be cleaned up
 *  alongside the encrypted file. */
export function backupDirForProfile(profileId: string): string {
  const baseRoot = resolve(
    process.env.BACKUP_DIR ?? join(dirname(livePath()), "backups"),
  );
  return join(baseRoot, profileId);
}

/** Root of the backup hierarchy — parent of every per-profile subdir.
 *  Used by the legacy-layout migration. */
function backupRootDir(): string {
  return resolve(
    process.env.BACKUP_DIR ?? join(dirname(livePath()), "backups"),
  );
}

/** One-shot migration: if the legacy layout (`<base>/budgets_*.sqlite`
 *  + their `.meta.json` sidecars directly under base) is present,
 *  move every file into `<base>/default/` so the per-profile layout
 *  takes over. Idempotent — repeated calls are no-ops once the legacy
 *  files are gone. */
export function migrateLegacyBackups(): void {
  const root = backupRootDir();
  if (!existsSync(root)) return;
  const defaultProfileSubdir = join(root, "default");
  let moved = 0;
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    // Subdirs (already-per-profile-organised) are skipped.
    if (statSync(full).isDirectory()) continue;
    // Migrate only files matching the backup pattern OR their meta
    // sidecars; leave anything else (e.g. a README) untouched.
    const isBackup = FILENAME_RE.test(name);
    const isMeta = /^budgets_(manual|scheduled|pre-restore)_[0-9TZ.\-]+\.sqlite\.meta\.json$/.test(name);
    if (!isBackup && !isMeta) continue;
    mkdirSync(defaultProfileSubdir, { recursive: true });
    const dest = join(defaultProfileSubdir, name);
    try {
      renameSync(full, dest);
      moved += 1;
    } catch {
      /* ignore — file may already exist at dest from a partial prior run */
    }
  }
  if (moved > 0) {
    console.log(`[backup] Migrated ${moved} legacy backup file(s) into <base>/default/`);
  }
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
  // Walk up the directory chain until we hit an existing path. Used
  // to be a single-level fallback (`existsSync(dir) ? dir :
  // dirname(dir)`) — sufficient when `backupDir()` was a flat
  // `<base>/`, since `<base>/..` always exists. Multi-DB pushed it
  // to `<base>/<profileId>/`, so on a fresh install both `<base>/`
  // AND `<base>/<profileId>/` are missing and the single fallback
  // landed on a non-existent path → `statfs` ENOENT → /api/backup
  // 500. Walking up bottoms out at `/` (or the data volume root),
  // which always exists.
  let target = backupDir();
  while (!existsSync(target)) {
    const parent = dirname(target);
    if (parent === target) break; // reached the filesystem root
    target = parent;
  }
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

/** Belt-and-braces guard for any function that takes a full path
 * (verifyBackup, looksLikeSqlcipher, swapLive). The API routes
 * already validate filenames via `isSafeBackupFilename` before
 * joining with `backupDir()`, but this re-checks the resolved path
 * is rooted in `backupDir()` so a future caller that skipped the
 * filename validator can't pass an arbitrary path through. Throws
 * — these functions have no useful behaviour on an out-of-dir
 * path, fail fast.
 *
 * Returns the resolved, in-bounds path. Callers MUST use the
 * returned value instead of the raw input — that's what makes the
 * dataflow visible to CodeQL's `js/path-injection` checker as a
 * sanitiser. Asserting without re-binding the value leaves the
 * tainted variable in scope for the downstream fs calls. */
export function assertWithinBackupDir(p: string): string {
  const root = resolve(backupDir());
  const candidate = resolve(p);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`Path is not inside the backup dir: ${p}`);
  }
  return candidate;
}

/** Sanitised resolver for the live DB path. The path is derived from
 * `livePath()` → active profile's filename → registry JSON, all of
 * which is operator-controlled (the registry file lives on disk and
 * could be hand-edited). Although `parseRegistry()` already rejects
 * filenames that fail `isValidFilename()` (basename === filename +
 * allow-list regex), CodeQL doesn't see that as a sanitiser — so
 * `renameSync(...)` against `livePath()` raised a
 * `js/path-injection` alert.
 *
 * Same fix shape as `assertWithinBackupDir`: assert AND re-bind. The
 * caller has to use the RETURN VALUE for CodeQL to recognise the
 * dataflow as sanitised; asserting in-place wouldn't be enough. */
function assertLivePath(p: string): string {
  // The active profile's file lives in the data directory (parent of
  // SQLITE_PATH). Resolve absolutely + assert containment, identical
  // shape to the backup-dir guard.
  const root = resolve(dirname(p));
  const candidate = resolve(p);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`Path escapes the data dir: ${p}`);
  }
  // Belt-and-braces: enforce the filename allow-list directly on
  // basename(candidate). `parseRegistry()` already rejects malformed
  // filenames upstream, but defending here means CodeQL sees a hard
  // regex check between the registry value and the fs call.
  const bn = basename(candidate);
  if (!/^[A-Za-z0-9_.\-]{1,80}\.db$/.test(bn)) {
    throw new Error(`Filename fails the allow-list: ${bn}`);
  }
  return candidate;
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
    const filepath = join(dir, name);
    const stat = statSync(filepath);
    const meta = readBackupMeta(filepath);
    out.push({
      filename: name,
      type: m[1] as BackupType,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      notes: meta.notes ?? null,
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
    notes: null,
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
  // Drop the sidecar metadata too — orphaned `.meta.json` files would
  // just clutter the directory and confuse the user if they exported
  // backups to a different machine.
  const meta = metaPathFor(path);
  if (existsSync(meta)) rmSync(meta);
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

/** Pull the schedule config from the multi-DB registry. The schedule
 *  is global — one config governs scheduled backups across every
 *  profile (only the currently-unlocked profile actually gets backed
 *  up when the timer fires, since SQLCipher needs an in-memory key
 *  to copy the file).
 *
 *  Reads from `databases.json` so this works pre-unlock too (the
 *  Settings page can render the schedule UI without the user typing
 *  a passphrase first). */
export function readSchedule(): BackupSchedule {
  const cfg = readScheduleFromRegistry();
  return {
    enabled: cfg.enabled,
    intervalDays: cfg.intervalDays,
    retain: cfg.retain,
    lastRunAt: cfg.lastRunAt,
  };
}

/** Persist a partial schedule update. Merges over the existing config
 *  so `lastRunAt` (touched by the scheduler) and the user-edited
 *  fields don't clobber each other. */
export function writeSchedule(patch: Partial<BackupSchedule>): BackupSchedule {
  const current = readSchedule();
  const next: BackupSchedule = { ...current, ...patch };
  writeScheduleToRegistry({
    enabled: next.enabled,
    intervalDays: next.intervalDays,
    retain: next.retain,
    lastRunAt: next.lastRunAt,
  });
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
  const safe = assertWithinBackupDir(path);
  if (!existsSync(safe)) return { ok: false, error: "Backup file not found" };
  let probe: ReturnType<typeof Database> | undefined;
  try {
    probe = new Database(safe);
    probe.pragma(`key = '${passphrase.replace(/'/g, "''")}'`);
    probe.pragma("cipher_compatibility = 4");
    probe.prepare("SELECT count(*) FROM sqlite_master").get();
    return { ok: true, size: statSync(safe).size };
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
  const safe = assertWithinBackupDir(path);
  if (!existsSync(safe)) return false;
  const head = Buffer.alloc(16);
  const fd = openSync(safe, "r");
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
  const safe = assertWithinBackupDir(newDbPath);
  lock();
  // Remove WAL + SHM siblings of the live DB — they belong to the
  // pre-restore connection and will be regenerated when the next
  // unlock opens the new file. `assertLivePath` re-binds the value
  // so CodeQL's path-injection checker sees a sanitised flow into
  // the fs.* calls below (the underlying livePath() resolves through
  // the user-editable registry JSON).
  const safeLive = assertLivePath(livePath());
  for (const suffix of ["-wal", "-shm"]) {
    const p = safeLive + suffix;
    if (existsSync(p)) {
      try {
        rmSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  renameSync(safe, safeLive);
}
