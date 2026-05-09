/**
 * Map a SQLCipher / fs error thrown when opening the database into
 * user-facing copy. Pure so the unlock-page UX can be exercised
 * without spinning up a real DB.
 *
 * The previous flow returned a single "Wrong passphrase." for every
 * failure, which made deploy-time footguns (volume mounted with the
 * wrong owner, read-only filesystem) look like a typo'd passphrase.
 * The most common deploy footgun by far is EACCES: K8s pods that
 * mount a volume at /data without setting `securityContext.fsGroup`
 * to match the image's uid, or docker-compose bind mounts that
 * weren't chowned to 1001:1001 on the host. Surfaces a specific
 * message for that case.
 *
 * SQLCipher's "file is not a database" stays ambiguous on purpose
 * — we don't want to leak whether the failure was a wrong key or
 * genuine corruption.
 */
export function describeOpenError(err: unknown, path: string): string {
  const e = err as { code?: string; message?: string } | null;

  // SQLCipher's `SQLITE_CANTOPEN` ("unable to open database file") is
  // overwhelmingly a volume-permission failure in containerised
  // deploys: the directory exists (so mkdirSync didn't throw) but
  // SQLite catches the EACCES on file-create internally and surfaces
  // its own opaque message. Treat it the same as a node-level EACCES.
  const isCantOpen =
    e?.code === "SQLITE_CANTOPEN" ||
    e?.message?.includes("unable to open database file");

  if (e?.code === "EACCES" || e?.code === "EPERM" || isCantOpen) {
    return `Can't open ${path}. The data directory must be writable by uid 1001 (the nextjs user inside the container). On Kubernetes set the pod's securityContext.fsGroup to 1001; on a docker bind mount, chown the host path to 1001:1001.`;
  }
  if (e?.code === "EROFS") {
    return `Read-only filesystem at ${path}. Mount the data volume read-write.`;
  }
  if (e?.code === "ENOSPC") {
    return "Disk full — can't create the database file.";
  }
  // SQLCipher signals wrong-key / corrupt by failing the
  // sqlite_master SELECT with this message. Keep it ambiguous.
  if (e?.message?.includes("file is not a database")) {
    return "Wrong passphrase or corrupted database file.";
  }
  return e?.message
    ? `Failed to open the database: ${e.message}`
    : "Failed to open the database.";
}
