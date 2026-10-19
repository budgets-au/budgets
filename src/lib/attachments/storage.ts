import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { dataDir, getActiveProfile } from "@/lib/db-profiles";

/** On-disk layout + path safety for receipt attachments.
 *
 *  Attachments live at `<dataDir>/attachments/<profileId>/<id>.enc`
 *  — one directory per profile so a `rmSync -rf` on profile delete
 *  wipes exactly that profile's attachments. The file bytes are
 *  AES-256-GCM-encrypted on upload (see `./crypto.ts`); this module
 *  owns disk I/O only — no crypto decisions here.
 *
 *  Writes are atomic (tmp file + rename) so a crash mid-upload
 *  can't leave a half-written file visible under its final name.
 *  Reads go through `assertWithinAttachmentsDir()` which CodeQL
 *  recognises as a `js/path-injection` sanitiser via the
 *  assert-and-rebind pattern established in `sqlite-backup.ts`
 *  (`assertWithinBackupDir`, `assertLivePath`).
 */

const BASENAME_RE = /^[0-9a-f-]{36}\.enc$/i;
/** Allow-list regex for the probe filename used by the Settings
 *  health check. Written and deleted inside the attachments root
 *  so the sanitiser's basename check still passes. */
const PROBE_BASENAME_RE = /^\.probe-[0-9a-f]{8}\.tmp$/;

/** Root of the attachments hierarchy — parent of every per-profile
 *  subdir. Deliberately NOT exported — call sites should use
 *  `attachmentsDirForProfile(id)` or `attachmentsPathFor(id)` so
 *  the per-profile scoping is explicit.
 *
 *  Resolution order:
 *   1. `ATTACHMENTS_PATH` env var, when set — lets operators mount
 *      a separate volume for receipts (useful when attachments
 *      grow larger than the DB volume should).
 *   2. `<dataDir>/attachments` — the historical default, co-located
 *      with the SQLite file so a single `/data` mount covers both.
 */
function attachmentsRootDir(): string {
  const envPath = process.env.ATTACHMENTS_PATH?.trim();
  return resolve(envPath && envPath.length > 0 ? envPath : join(dataDir(), "attachments"));
}

/** Public read of the resolved attachments root path. The Settings
 *  "Attachments store" panel + the health-check route surface this
 *  to the operator so they can see which directory the app will
 *  write receipts into — resolved from `ATTACHMENTS_PATH` or the
 *  `<dataDir>/attachments` fallback. */
export function attachmentsRootPath(): string {
  return attachmentsRootDir();
}

/** Per-profile attachments directory. Analogous to
 *  `backupDirForProfile(id)` in `sqlite-backup.ts`. Used by:
 *   - the upload path when writing a new file,
 *   - the download path when reading one back,
 *   - the profile-delete cleanup in `api/databases/[id]`. */
export function attachmentsDirForProfile(profileId: string): string {
  return join(attachmentsRootDir(), profileId);
}

/** Active-profile attachments directory. Shortcut for the usual
 *  upload / download / list call sites that don't need the
 *  explicit-profile variant. */
export function attachmentsDir(): string {
  return attachmentsDirForProfile(getActiveProfile().id);
}

/** Absolute path to one attachment's `.enc` file inside the active
 *  profile's directory. `attachmentId` is the attachment-table PK
 *  — a UUID generated at insert time. */
export function attachmentsPathFor(attachmentId: string): string {
  return join(attachmentsDir(), `${attachmentId}.enc`);
}

/** CodeQL-recognised sanitiser for any path flowing into `fs.*`.
 *  Returns the asserted path so the caller MUST rebind — same
 *  shape as `assertWithinBackupDir` / `assertLivePath` in
 *  `sqlite-backup.ts`, same reason: asserting in place leaves the
 *  tainted variable in scope and raises a `js/path-injection`
 *  alert on every downstream fs call. */
export function assertWithinAttachmentsDir(p: string): string {
  const root = resolve(attachmentsRootDir());
  const candidate = resolve(p);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new Error(`Path is not inside the attachments dir: ${p}`);
  }
  // Belt-and-braces basename check. Every attachment file is named
  // `<uuid>.enc` by this module; nothing else should ever live in
  // these directories.
  const bn = basename(candidate);
  if (
    bn.length > 0 &&
    !BASENAME_RE.test(bn) &&
    !PROBE_BASENAME_RE.test(bn) &&
    !bn.match(/^[0-9a-f-]+$/i)
  ) {
    // Second regex: bare profileId when the caller is the
    // profile-delete cleanup wiping an entire directory.
    // Probe regex: the startup health-check writes a short-lived
    // `.probe-<hex>.tmp` file at the root and deletes it; whitelist
    // the shape so the write stays inside the sanitiser.
    throw new Error(`Attachment filename fails the allow-list: ${bn}`);
  }
  return candidate;
}

/** Ensure the active profile's attachments directory exists.
 *  Called from the upload route before the first write; cheap to
 *  call repeatedly (mkdir with `recursive: true` is a no-op when
 *  the directory already exists). */
export async function ensureAttachmentsDir(): Promise<string> {
  const dir = assertWithinAttachmentsDir(attachmentsDir());
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Atomic write of a complete `[nonce ‖ ct ‖ tag]` buffer to disk
 *  at the attachment's final path. Follows the project convention
 *  (see `db-profiles.ts:230-236`): write to a `.tmp` sibling, then
 *  `rename` into place so a reader never observes a partial file.
 *  Any failure between write and rename leaves `.tmp` on disk — a
 *  periodic sweep could clean it, but a surviving stray costs ~tens
 *  of KB and is caught by the surrounding try/catch in the upload
 *  route. */
export async function writeAttachmentAtomic(
  attachmentId: string,
  encrypted: Buffer,
): Promise<string> {
  await ensureAttachmentsDir();
  const finalPath = assertWithinAttachmentsDir(attachmentsPathFor(attachmentId));
  const tmpPath = assertWithinAttachmentsDir(
    join(dirname(finalPath), `.${basename(finalPath)}.${randomBytes(4).toString("hex")}.tmp`),
  );
  await writeFile(tmpPath, encrypted);
  await rename(tmpPath, finalPath);
  return finalPath;
}

/** Delete one attachment file. Best-effort — if the file is already
 *  gone (orphan or manual cleanup) the caller shouldn't fail. */
export async function deleteAttachmentFile(attachmentId: string): Promise<void> {
  const path = assertWithinAttachmentsDir(attachmentsPathFor(attachmentId));
  await rm(path, { force: true });
}

/** On-disk size of one attachment file (nonce + ct + tag). Used by
 *  the download path to allocate the Response's Content-Length. */
export async function attachmentFileSize(attachmentId: string): Promise<number> {
  const path = assertWithinAttachmentsDir(attachmentsPathFor(attachmentId));
  const s = await stat(path);
  return s.size;
}
