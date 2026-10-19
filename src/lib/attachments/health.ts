import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  assertWithinAttachmentsDir,
  attachmentsRootPath,
} from "./storage";

/** Startup / Settings probe for the receipts-attachments store.
 *
 *  The attachments directory may live on a volume the container
 *  does have mounted but doesn't have write permission to (common
 *  Docker gotcha: pre-create `/data` as root, forget to chown it
 *  for the `nextjs` user), or on a mount that's missing entirely
 *  (`ATTACHMENTS_PATH=/receipts` without the volume declared).
 *  Both scenarios surface as an opaque 500 on the first upload.
 *
 *  This probe is the pre-flight the Settings page runs and the
 *  Dashboard banner guards on: it does a round-trip write + read +
 *  delete of a short-lived `.probe-<hex>.tmp` file in the root of
 *  the attachments tree. If any step fails, the operator gets an
 *  explicit message naming the path and the OS error — much
 *  friendlier than "500" on the first POST.
 *
 *  The probe filename is whitelisted by `storage.ts` so the
 *  CodeQL-recognised sanitiser lets it through. The write + read +
 *  delete leaves no trace on success.
 */

export interface AttachmentsHealth {
  /** The root path the app will write attachments under
   *  (resolved from `ATTACHMENTS_PATH` or the
   *  `<dataDir>/attachments` fallback). */
  path: string;
  /** True when the probe succeeded end-to-end. */
  ok: boolean;
  /** When `ok` is false, a human-readable reason — surfaced in the
   *  Settings panel and the Dashboard banner. Includes the raw OS
   *  error code (`EACCES`, `ENOENT`, `EROFS`, …) when present. */
  error?: string;
  /** Where the problem happened — helps the operator diagnose. */
  stage?: "mkdir" | "write" | "read" | "delete" | "verify";
}

export async function attachmentsHealthCheck(): Promise<AttachmentsHealth> {
  const root = attachmentsRootPath();
  const probeName = `.probe-${randomBytes(4).toString("hex")}.tmp`;
  const probePath = assertWithinAttachmentsDir(join(root, probeName));
  const payload = Buffer.from(`budgets-probe:${Date.now()}`);

  try {
    await mkdir(root, { recursive: true });
  } catch (e) {
    return { path: root, ok: false, stage: "mkdir", error: friendlyFsError(e) };
  }

  try {
    await writeFile(probePath, payload);
  } catch (e) {
    return { path: root, ok: false, stage: "write", error: friendlyFsError(e) };
  }

  let readBack: Buffer;
  try {
    readBack = await readFile(probePath);
  } catch (e) {
    // Best-effort cleanup — if we can't read it, we probably can't
    // delete it either, but try anyway so an orphan doesn't
    // accumulate on repeated probes.
    await rm(probePath, { force: true }).catch(() => {});
    return { path: root, ok: false, stage: "read", error: friendlyFsError(e) };
  }

  if (!readBack.equals(payload)) {
    await rm(probePath, { force: true }).catch(() => {});
    return {
      path: root,
      ok: false,
      stage: "verify",
      error: "Probe file round-tripped with different bytes — the volume may be caching aggressively or returning stale data.",
    };
  }

  try {
    await rm(probePath, { force: true });
  } catch (e) {
    return { path: root, ok: false, stage: "delete", error: friendlyFsError(e) };
  }

  return { path: root, ok: true };
}

function friendlyFsError(e: unknown): string {
  if (e instanceof Error) {
    // Node attaches `code` as a non-standard property on fs errors.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EACCES") {
      return "Permission denied (EACCES). The container user can't write to this path — chown the volume to the app user or mount it with the right ownership.";
    }
    if (code === "EROFS") {
      return "Filesystem is read-only (EROFS). The mount options would need to be changed before receipts can be stored here.";
    }
    if (code === "ENOENT") {
      return "Path doesn't exist (ENOENT). The parent directory is missing — declare the volume mount or set `ATTACHMENTS_PATH` to a path that exists in the container.";
    }
    if (code === "ENOSPC") {
      return "Disk is full (ENOSPC). Free space on the volume before uploading more receipts.";
    }
    return `${code ?? "Error"}: ${e.message}`;
  }
  return String(e);
}
