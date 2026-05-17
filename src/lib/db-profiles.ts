import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Multi-database profile registry.
 *
 * The app supports multiple SQLCipher databases stored side-by-side in
 * the same data directory (the parent of `process.env.SQLITE_PATH`).
 * Each profile is a tuple of `{ id, label, filename, createdAt }`
 * persisted in `databases.json` next to the DB files.
 *
 * Decisions baked in here (per the user spec):
 *   - Per-DB passphrase. SQLCipher's existing mechanism — each file
 *     is independently keyed; switching profiles always forces a
 *     trip through `/unlock`.
 *   - Re-unlock on switch. The active in-memory connection is locked
 *     when the user picks another profile; no key cache.
 *   - No cross-DB views. Each request operates on exactly one active
 *     profile.
 *   - Global backup schedule. Stored on the registry file (NOT inside
 *     any individual DB's app_settings), so a single config governs
 *     scheduled backups across whichever profile happens to be
 *     unlocked when the timer fires.
 *
 * `databases.json` lives at `<dataDir>/databases.json` and is NOT
 * encrypted — by design. The active-profile pointer and the backup
 * schedule have to be readable before any passphrase is entered.
 * The file contains no secrets; just metadata + the optional
 * scheduled-backup config.
 *
 * On first read after a fresh-or-pre-multi-DB install, the registry
 * seeds itself with a single "default" profile pointing at the
 * existing SQLITE_PATH basename. Subsequent reads return the live
 * file state.
 */

export interface DbProfile {
  /** Stable slug used in URLs + backup subdirectory naming.
   *  Lower-case alphanumerics + dash. Generated on create. */
  id: string;
  /** User-facing display name. Editable later. */
  label: string;
  /** Bare filename under `<dataDir>`. Constructed on create as
   *  `budget-<id>.db` for new profiles; preserved as-is for the
   *  legacy default profile that points at the existing file. */
  filename: string;
  createdAt: string;
}

export interface BackupScheduleConfig {
  enabled: boolean;
  intervalDays: number;
  retain: number;
  lastRunAt: string | null;
}

export interface DbRegistry {
  profiles: DbProfile[];
  /** Stable id of the profile the server should treat as active on
   *  process start. Updated whenever the user picks a different one
   *  via the switcher. Cleared back to the first profile if the
   *  pointed-at profile is removed. */
  activeProfileId: string;
  /** Global scheduled-backup config (was previously
   *  `app_settings.backup_schedule`, now lives outside any DB so
   *  one schedule governs every profile). Migrated from the active
   *  DB's app_settings on first multi-DB-aware startup. */
  backupSchedule: BackupScheduleConfig | null;
}

const DEFAULT_SCHEDULE: BackupScheduleConfig = {
  enabled: false,
  intervalDays: 1,
  retain: 14,
  lastRunAt: null,
};

const SQLITE_PATH = process.env.SQLITE_PATH ?? "/data/budget.db";

export function dataDir(): string {
  return dirname(SQLITE_PATH);
}

function registryPath(): string {
  return join(dataDir(), "databases.json");
}

const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function isValidProfileId(id: string): boolean {
  return typeof id === "string" && PROFILE_ID_RE.test(id);
}

function isValidFilename(fn: string): boolean {
  // Bare basename, no separator, no .. ; ends with .db; reasonable len.
  return (
    typeof fn === "string" &&
    basename(fn) === fn &&
    /^[A-Za-z0-9_.\-]{1,80}\.db$/.test(fn)
  );
}

function freshSlug(): string {
  // 8-char base36 from a random UUID — short, URL-safe, no collisions
  // in practice for the small N we expect.
  return randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
}

function defaultRegistry(): DbRegistry {
  const legacyFilename = basename(SQLITE_PATH);
  return {
    profiles: [
      {
        id: "default",
        label: "Default",
        filename: legacyFilename,
        createdAt: new Date().toISOString(),
      },
    ],
    activeProfileId: "default",
    backupSchedule: { ...DEFAULT_SCHEDULE },
  };
}

function parseRegistry(raw: string): DbRegistry | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const profiles = obj.profiles;
  if (!Array.isArray(profiles)) return null;
  const cleaned: DbProfile[] = [];
  const seenIds = new Set<string>();
  for (const p of profiles) {
    if (!p || typeof p !== "object") continue;
    const pr = p as Record<string, unknown>;
    const id = typeof pr.id === "string" ? pr.id : "";
    const label = typeof pr.label === "string" ? pr.label : "";
    const filename = typeof pr.filename === "string" ? pr.filename : "";
    const createdAt =
      typeof pr.createdAt === "string"
        ? pr.createdAt
        : new Date().toISOString();
    if (!isValidProfileId(id) || seenIds.has(id)) continue;
    if (!label) continue;
    if (!isValidFilename(filename)) continue;
    seenIds.add(id);
    cleaned.push({ id, label, filename, createdAt });
  }
  if (cleaned.length === 0) return null;
  const activeRaw = obj.activeProfileId;
  const active =
    typeof activeRaw === "string" && cleaned.some((p) => p.id === activeRaw)
      ? activeRaw
      : cleaned[0].id;
  let schedule: BackupScheduleConfig | null = null;
  const s = obj.backupSchedule;
  if (s && typeof s === "object") {
    const so = s as Record<string, unknown>;
    schedule = {
      enabled: so.enabled === true,
      intervalDays:
        typeof so.intervalDays === "number" && so.intervalDays > 0
          ? Math.floor(so.intervalDays)
          : DEFAULT_SCHEDULE.intervalDays,
      retain:
        typeof so.retain === "number" && so.retain >= 0
          ? Math.floor(so.retain)
          : DEFAULT_SCHEDULE.retain,
      lastRunAt:
        typeof so.lastRunAt === "string" ? so.lastRunAt : null,
    };
  }
  return { profiles: cleaned, activeProfileId: active, backupSchedule: schedule };
}

let cached: DbRegistry | null = null;

/** Force a re-read on the next access. Used after a switch / create /
 *  delete operation to keep the in-memory copy honest. */
export function invalidateRegistryCache(): void {
  cached = null;
}

/** Read the registry, seeding the file on first access. Cached
 *  per-process; call `invalidateRegistryCache()` after writes. */
export function readRegistry(): DbRegistry {
  if (cached) return cached;
  const p = registryPath();
  if (!existsSync(p)) {
    const seeded = defaultRegistry();
    mkdirSync(dirname(p), { recursive: true });
    writeRegistry(seeded);
    cached = seeded;
    return seeded;
  }
  const raw = readFileSync(p, "utf8");
  const parsed = parseRegistry(raw);
  if (!parsed) {
    // File present but unparseable — fall back to a default registry
    // rather than refuse to boot. Subsequent writes overwrite.
    cached = defaultRegistry();
    return cached;
  }
  cached = parsed;
  return parsed;
}

/** Atomic write to `databases.json`. tmp file + rename so a crash
 *  mid-write leaves the previous version intact. */
export function writeRegistry(next: DbRegistry): void {
  const p = registryPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, p);
  cached = next;
}

/** Convenience: the active profile object (synchronously resolved
 *  from the cached registry). */
export function getActiveProfile(): DbProfile {
  const reg = readRegistry();
  const active = reg.profiles.find((p) => p.id === reg.activeProfileId);
  if (!active) {
    // The registry should self-heal in parseRegistry, but defend in
    // depth by falling back to the first profile.
    return reg.profiles[0];
  }
  return active;
}

/** Absolute path on disk for a given profile. */
export function pathForProfile(profile: DbProfile): string {
  return join(dataDir(), profile.filename);
}

/** Absolute path of the active profile's DB file. Used as the
 *  in-process `livePath` equivalent. */
export function activeLivePath(): string {
  return pathForProfile(getActiveProfile());
}

/** Set the active profile id. Caller is responsible for locking the
 *  current DB connection BEFORE calling so subsequent requests don't
 *  read from a stale handle. Throws if the id isn't in the registry. */
export function setActiveProfileId(id: string): void {
  const reg = readRegistry();
  if (!reg.profiles.some((p) => p.id === id)) {
    throw new Error(`Unknown profile id: ${id}`);
  }
  if (reg.activeProfileId === id) return;
  writeRegistry({ ...reg, activeProfileId: id });
}

/** Append a new profile to the registry with a fresh slug. Returns
 *  the new profile (already persisted). Caller still has to OPEN the
 *  file with the desired passphrase — this just records its
 *  existence in the metadata. */
export function createProfile(label: string): DbProfile {
  const trimmed = label.trim();
  if (!trimmed) throw new Error("Label is required");
  if (trimmed.length > 80) throw new Error("Label must be ≤ 80 chars");
  const reg = readRegistry();
  // Case-insensitive uniqueness on label. Three "Test DB" entries
  // in the dropdown is the symptom this guard prevents — the
  // filename allocator is already unique-by-slug, but the label
  // is the operator's primary disambiguator.
  const lowered = trimmed.toLowerCase();
  if (reg.profiles.some((p) => p.label.toLowerCase() === lowered)) {
    throw new Error(`A database labelled "${trimmed}" already exists`);
  }
  // Generate a unique id with up to 5 attempts; the 8-char base36 has
  // collision odds that make 5 essentially infinite headroom.
  let id = freshSlug();
  for (let i = 0; i < 5 && reg.profiles.some((p) => p.id === id); i++) {
    id = freshSlug();
  }
  if (reg.profiles.some((p) => p.id === id)) {
    throw new Error("Could not allocate a unique profile id");
  }
  const filename = `budget-${id}.db`;
  const profile: DbProfile = {
    id,
    label: trimmed,
    filename,
    createdAt: new Date().toISOString(),
  };
  writeRegistry({ ...reg, profiles: [...reg.profiles, profile] });
  return profile;
}

/** Rename a profile. Case-insensitive uniqueness check on the new
 *  label — same rule `createProfile` enforces on insert.
 *  Throws when the id isn't registered or the new label collides
 *  with another profile. */
export function renameProfile(id: string, nextLabel: string): DbProfile {
  const trimmed = nextLabel.trim();
  if (!trimmed) throw new Error("Label is required");
  if (trimmed.length > 80) throw new Error("Label must be ≤ 80 chars");
  const reg = readRegistry();
  const target = reg.profiles.find((p) => p.id === id);
  if (!target) throw new Error(`Unknown profile id: ${id}`);
  const lowered = trimmed.toLowerCase();
  if (
    reg.profiles.some(
      (p) => p.id !== id && p.label.toLowerCase() === lowered,
    )
  ) {
    throw new Error(`A database labelled "${trimmed}" already exists`);
  }
  if (target.label === trimmed) return target;
  const updated: DbProfile = { ...target, label: trimmed };
  writeRegistry({
    ...reg,
    profiles: reg.profiles.map((p) => (p.id === id ? updated : p)),
  });
  return updated;
}

/** Read the global scheduled-backup config. Returns the registry's
 *  schedule, or the built-in default when none is set. */
export function readSchedule(): BackupScheduleConfig {
  const reg = readRegistry();
  return reg.backupSchedule ?? { ...DEFAULT_SCHEDULE };
}

/** Update the global scheduled-backup config. */
export function writeSchedule(next: BackupScheduleConfig): void {
  const reg = readRegistry();
  writeRegistry({ ...reg, backupSchedule: next });
}
