import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, transactionAttachments } from "@/db/schema";
import { getActiveProfile } from "@/lib/db-profiles";
import { onDbContextChange } from "@/lib/db-context";
import { hasAttachmentFiles } from "./storage";

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

/** Thrown when a profile already holds encrypted attachments but its DB has
 *  no key (e.g. restored from a backup older than the first upload). Minting a
 *  fresh key there would make the existing files permanently unreadable. */
export class AttachmentKeyMissingError extends Error {
  constructor() {
    super(
      "This database has receipt attachments but no attachment key — it was " +
        "probably restored from a backup taken before the first upload. Restore " +
        "a newer backup to recover the existing receipts.",
    );
    this.name = "AttachmentKeyMissingError";
  }
}

// Scoped to the profile it was read from, and cleared on every lock /
// profile switch / restore via the db-context registry.
let cachedDek: { profileId: string; dek: Buffer } | null = null;
onDbContextChange(() => {
  cachedDek = null;
});

async function readStoredDek(): Promise<Buffer | null> {
  const [row] = await db
    .select({ attachmentsDek: appSettings.attachmentsDek })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  if (!row?.attachmentsDek) return null;
  const dek = Buffer.from(row.attachmentsDek, "base64");
  if (dek.length !== DEK_LEN) {
    throw new Error(`attachments DEK is ${dek.length} bytes; expected ${DEK_LEN}`);
  }
  return dek;
}

/** Return the active profile's data-encryption key, creating it on first use.
 *  The key lives in `app_settings.attachments_dek` inside the SQLCipher DB, so
 *  the operator passphrase protects it and `/rekey` never touches attachment
 *  files. Creation is first-writer-wins (`UPDATE … WHERE attachments_dek IS
 *  NULL`), so concurrent first uploads all converge on one key. */
export async function ensureDek(): Promise<Buffer> {
  const profileId = getActiveProfile().id;
  if (cachedDek?.profileId === profileId) return cachedDek.dek;

  let dek = await readStoredDek();
  if (!dek) {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(transactionAttachments);
    if (n > 0 || (await hasAttachmentFiles())) throw new AttachmentKeyMissingError();

    await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
    await db
      .update(appSettings)
      .set({ attachmentsDek: randomBytes(DEK_LEN).toString("base64") })
      .where(and(eq(appSettings.id, 1), isNull(appSettings.attachmentsDek)));
    dek = await readStoredDek();
    if (!dek) throw new Error("failed to persist the attachments key");
  }
  cachedDek = { profileId, dek };
  return dek;
}

/** Test seam: drop the cached key. */
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
