/**
 * Singleton scheduler for automatic backups. Runs on module load —
 * imported eagerly from `src/proxy.ts` so the interval starts at
 * server boot rather than first request.
 *
 * Tick cadence is fixed at 60s; whether a backup actually fires is
 * decided by `intervalDays` and `lastRunAt` from app_settings on
 * every tick. Reading config each tick (rather than on schedule
 * change) means the user's edits in the UI take effect within a
 * minute without restarting.
 *
 * HMR-safe: in dev, hot reloads re-evaluate this module. The
 * globalThis-pinned `__backupScheduler` keeps a reference to the
 * existing interval so we can clear it before registering the new
 * one and never end up with two timers running.
 *
 * Locked DB: if the app is in locked mode the scheduler can't read
 * config or take a backup. It logs once and silently tries again on
 * the next tick — typical for a fresh boot where the user hasn't
 * unlocked yet.
 */
import { isUnlocked } from "@/db";
import type { BackupSchedule } from "@/db/schema";
// `sqlite-backup` is lazy-required INSIDE tick() (not imported at the
// top of this module) because both files participate in the @/db
// dependency cycle: this module is loaded eagerly from `src/proxy.ts`
// at boot, before @/db has finished initialising — webpack bundles the
// named imports from sqlite-backup into TDZ state during that window
// and `(0, lB.readSchedule) is not a function` fires on the first
// scheduler tick. By the time the 60s timer first fires, @/db is fully
// up; requiring inside tick() returns the live bindings.
import type {
  readSchedule as readScheduleFn,
  takeBackup as takeBackupFn,
  writeSchedule as writeScheduleFn,
} from "@/lib/backup/sqlite-backup";

function loadBackupModule(): {
  readSchedule: typeof readScheduleFn;
  takeBackup: typeof takeBackupFn;
  writeSchedule: typeof writeScheduleFn;
} {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("@/lib/backup/sqlite-backup");
}

const TICK_MS = 60_000;
const MS_PER_DAY = 86_400_000;

/** Pure cadence decision: should the scheduler fire a backup now? Extracted
 * from `tick()` so the branches are unit-testable without the singleton
 * timer + DB layer. The caller still owns the side-effects (firing the
 * backup, writing `lastRunAt`). */
export function shouldFireBackup(
  cfg: BackupSchedule,
  nowMs: number,
): boolean {
  if (!cfg.enabled) return false;
  const intervalMs = Math.max(0, cfg.intervalDays) * MS_PER_DAY;
  if (intervalMs === 0) return false;
  const last = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0;
  return nowMs - last >= intervalMs;
}

interface SchedulerHandle {
  timer: NodeJS.Timeout;
  /** Ratchets up on each consecutive locked tick so the log doesn't
   * flood while the DB is awaiting unlock. */
  lockedTickCount: number;
}

const globalForScheduler = globalThis as unknown as {
  __backupScheduler?: SchedulerHandle;
};

function tick(): void {
  if (!isUnlocked()) {
    const handle = globalForScheduler.__backupScheduler;
    if (handle) {
      // Log only on the first locked tick so the dev console isn't
      // flooded.
      if (handle.lockedTickCount === 0) {
        console.log(
          "[backup-scheduler] DB is locked — skipping until unlocked.",
        );
      }
      handle.lockedTickCount += 1;
    }
    return;
  }
  // Reset the locked counter so the next time the DB locks we get
  // exactly one log line.
  if (globalForScheduler.__backupScheduler) {
    globalForScheduler.__backupScheduler.lockedTickCount = 0;
  }

  const backup = loadBackupModule();
  let cfg;
  try {
    cfg = backup.readSchedule();
  } catch (e) {
    console.error("[backup-scheduler] Failed to read schedule:", e);
    return;
  }
  const now = Date.now();
  if (!shouldFireBackup(cfg, now)) return;

  // Fire-and-forget; the next tick recovers naturally if takeBackup
  // throws (we don't update lastRunAt unless it succeeded).
  backup.takeBackup("scheduled")
    .then(() => {
      backup.writeSchedule({ lastRunAt: new Date(now).toISOString() });
      console.log("[backup-scheduler] Took scheduled backup.");
    })
    .catch((err) => {
      console.error("[backup-scheduler] Scheduled backup failed:", err);
    });
}

/** Register the singleton interval. Idempotent — safe to call again
 * after an HMR reload. */
function start(): void {
  // Tear down any previous interval (HMR / repeat-import).
  if (globalForScheduler.__backupScheduler) {
    clearInterval(globalForScheduler.__backupScheduler.timer);
  }
  const timer = setInterval(tick, TICK_MS);
  // Don't keep the event loop alive solely for the scheduler — Node
  // can shut down cleanly on SIGTERM without us holding it open.
  if (typeof timer.unref === "function") timer.unref();
  globalForScheduler.__backupScheduler = { timer, lockedTickCount: 0 };
}

// Skip in test environments — vitest imports modules eagerly and we
// don't want a 60s timer hanging around between tests.
if (process.env.NODE_ENV !== "test") {
  start();
}
