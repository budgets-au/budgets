import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/** Receipt-attachment encryption primitives.
 *
 *  The transaction-attachments feature stores receipt files on disk
 *  outside the SQLCipher-encrypted DB (SQLCipher's `BLOB` ceiling
 *  makes a 25 MiB PDF per row awkward, and we want range-reads for
 *  streaming downloads). Those files need the same confidentiality
 *  envelope as the ledger itself — "whoever has the operator
 *  passphrase has everything".
 *
 *  Design (see plan file + 0.353 CHANGELOG):
 *
 *  - A single 32-byte random **data-encryption-key (DEK)** is
 *    generated lazily on first upload and stored (base64) in
 *    `app_settings.attachments_dek`. That column lives INSIDE the
 *    SQLCipher-encrypted DB, so the DEK bytes are protected by the
 *    operator's passphrase without exposing a second passphrase.
 *
 *  - Each attachment file is AES-256-GCM encrypted under the DEK
 *    with a per-file 12-byte random nonce. The on-disk layout is
 *    `[nonce (12 bytes)][ciphertext (N bytes)][authTag (16 bytes)]`,
 *    with no file header — attachment metadata (filename, content
 *    type, size, sha256) lives in the DB.
 *
 *  - Rotating the operator passphrase (`PRAGMA rekey`) re-encrypts
 *    every page of the DB file with the new passphrase, including
 *    the page carrying the DEK. The DEK bytes themselves don't
 *    change, so previously-encrypted attachment files remain
 *    readable with no file-level re-encryption needed. Rekey stays
 *    O(1) in the number of attachments.
 */

const NONCE_LEN = 12;
const TAG_LEN = 16;
const DEK_LEN = 32; // 256 bits
const ALGO = "aes-256-gcm" as const;

/** Return the DEK bytes, generating + persisting a fresh one on
 *  first call. Reads come from the SQLCipher-protected
 *  `app_settings` row (singleton id=1 — see schema). Writes use the
 *  same `onConflictDoUpdate` pattern as the Brave-Search key row so
 *  concurrent first-upload races don't trip the UNIQUE constraint;
 *  the first writer wins, the second quietly no-ops and reads back
 *  the row they lost to.
 *
 *  The DEK is cached in-process for the lifetime of the Node
 *  worker so subsequent uploads don't re-query. A rekey has no
 *  effect on the DEK bytes themselves (see file header) so the
 *  cache stays valid across rekeys; what IS invalidated is a
 *  server restart, which pays a single DB round-trip to re-prime. */
let cachedDek: Buffer | null = null;

export async function ensureDek(): Promise<Buffer> {
  if (cachedDek) return cachedDek;

  const [row] = await db
    .select({ attachmentsDek: appSettings.attachmentsDek })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);

  if (row?.attachmentsDek) {
    cachedDek = Buffer.from(row.attachmentsDek, "base64");
    if (cachedDek.length !== DEK_LEN) {
      throw new Error(
        `attachments DEK on disk is ${cachedDek.length} bytes; expected ${DEK_LEN}`,
      );
    }
    return cachedDek;
  }

  const fresh = randomBytes(DEK_LEN);
  const encoded = fresh.toString("base64");
  // Singleton row might not exist yet (fresh DB, no settings panel
  // ever hit). Upsert on id=1 is the project-wide shape for this
  // row — see `brave-search-key` route for the precedent.
  await db
    .insert(appSettings)
    .values({ id: 1, attachmentsDek: encoded })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { attachmentsDek: encoded, updatedAt: new Date() },
    });

  // Re-read in case we lost the race — the writer who won wrote a
  // different random blob and the cache needs to agree with disk.
  const [after] = await db
    .select({ attachmentsDek: appSettings.attachmentsDek })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  const final = after?.attachmentsDek ?? encoded;
  cachedDek = Buffer.from(final, "base64");
  return cachedDek;
}

/** Clear the in-process DEK cache. Call sites: `/rekey` route (so
 *  the next upload re-reads the DEK through the newly-keyed
 *  SQLCipher connection — strictly speaking unnecessary since the
 *  bytes don't change, but a free guard against subtle bugs where
 *  the connection handle might have changed), and the test suite. */
export function resetDekCache(): void {
  cachedDek = null;
}

/** AES-256-GCM encrypt a Buffer. Layout: `[nonce ‖ ciphertext ‖
 *  tag]`. Used by the upload route for small bodies where streaming
 *  the inbound body straight to a cipher is overkill. */
export function encryptBytes(plaintext: Buffer, dek: Buffer): Buffer {
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv(ALGO, dek, nonce);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, ct, tag]);
}

/** Decrypt a full `[nonce ‖ ct ‖ tag]` buffer. Throws on tag
 *  mismatch — the GCM authentication check is the integrity signal
 *  the file hasn't been truncated or tampered with. */
export function decryptBytes(encrypted: Buffer, dek: Buffer): Buffer {
  if (encrypted.length < NONCE_LEN + TAG_LEN) {
    throw new Error("encrypted blob too short to contain nonce + tag");
  }
  const nonce = encrypted.subarray(0, NONCE_LEN);
  const ct = encrypted.subarray(NONCE_LEN, encrypted.length - TAG_LEN);
  const tag = encrypted.subarray(encrypted.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, dek, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Read a `.enc` attachment file from disk, decrypt it, return
 *  plaintext. The 25 MiB upload cap means at most 25 MiB in memory
 *  per concurrent download — a comfortable ceiling on a single-
 *  machine LAN deployment. If the feature ever needs 100 MiB
 *  receipts, revisit with a streaming decryptor that buffers only
 *  the trailing TAG_LEN bytes. */
export async function readAndDecryptFile(path: string, dek: Buffer): Promise<Buffer> {
  const encrypted = await readFile(path);
  return decryptBytes(encrypted, dek);
}

export const ATTACHMENT_CRYPTO = {
  NONCE_LEN,
  TAG_LEN,
  DEK_LEN,
  ALGO,
} as const;
