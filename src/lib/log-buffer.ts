import { format as inspect } from "node:util";

/** In-process ring buffer that captures console output for later
 *  retrieval via `GET /api/logs`. On module load `installConsoleHooks`
 *  patches every `console.*` method so its call ALSO appends here;
 *  the buffer is a plain array capped at `MAX_ENTRIES` (oldest
 *  entries evicted first). Memory-only — restarts wipe it.
 *
 *  ── Privacy caveat ──
 *  Every string that reaches a captured `console.*` also lands in
 *  this buffer, and the buffer is served (behind auth) via
 *  `/api/logs`. Anything the code prints CAN be read by a valid
 *  bearer / session. Convention across the codebase is that
 *  console.* holds boot notices, error messages, and infra
 *  telemetry — NOT transaction detail, payee strings, amounts, or
 *  passphrases. New contributors should follow that convention;
 *  the log-endpoint's scope-gate (`ops`) exists on the assumption
 *  it stays true.
 */

export type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export interface LogEntry {
  ts: string; // ISO
  level: LogLevel;
  msg: string;
}

const MAX_ENTRIES = 1000;
const buffer: LogEntry[] = [];
let installed = false;

/** Idempotent — safe to import the module multiple times (Next.js
 *  route handlers and test fixtures both cause reloads). */
export function installConsoleHooks(): void {
  if (installed) return;
  installed = true;
  const raw = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };
  for (const level of Object.keys(raw) as LogLevel[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any)[level] = (...args: unknown[]) => {
      try {
        push(level, inspect(...(args as [unknown, ...unknown[]])));
      } catch {
        // Never let a buffer-write error break the caller's console.*
      }
      raw[level](...args);
    };
  }
}

function push(level: LogLevel, msg: string): void {
  buffer.push({ ts: new Date().toISOString(), level, msg });
  if (buffer.length > MAX_ENTRIES) {
    // Trim in one splice for O(1) amortised eviction — pushing then
    // shift() on every write would move the array on every call.
    const overflow = buffer.length - MAX_ENTRIES;
    buffer.splice(0, overflow);
  }
}

/** Return the tail of the buffer, most recent last. `limit` clamps
 *  to `MAX_ENTRIES`. `levels`, if provided, filters — omit for all. */
export function getRecentLogs(opts?: {
  limit?: number;
  levels?: LogLevel[];
}): LogEntry[] {
  const limit = Math.min(
    Math.max(1, opts?.limit ?? 200),
    MAX_ENTRIES,
  );
  const src = opts?.levels
    ? buffer.filter((e) => opts.levels!.includes(e.level))
    : buffer;
  return src.slice(-limit);
}

/** Test-only — clears the buffer without touching the console
 *  patch. Wired to the vitest suite; production code should not
 *  call this. */
export function __resetLogBuffer(): void {
  buffer.length = 0;
}
