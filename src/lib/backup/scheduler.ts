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
import {
  readSchedule,
  takeBackup,
  writeSchedule,
} from "@/lib/backup/sqlite-backup";

const TICK_MS = 60_000;
const MS_PER_DAY = 86_400_000;

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

  let cfg;
  try {
    cfg = readSchedule();
  } catch (e) {
    console.error("[backup-scheduler] Failed to read schedule:", e);
    return;
  }
  if (!cfg.enabled) return;

  const intervalMs = Math.max(0, cfg.intervalDays) * MS_PER_DAY;
  if (intervalMs === 0) return;

  const last = cfg.lastRunAt ? new Date(cfg.lastRunAt).getTime() : 0;
  const now = Date.now();
  if (now - last < intervalMs) return;

  // Fire-and-forget; the next tick recovers naturally if takeBackup
  // throws (we don't update lastRunAt unless it succeeded).
  takeBackup("scheduled")
    .then(() => {
      writeSchedule({ lastRunAt: new Date(now).toISOString() });
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
