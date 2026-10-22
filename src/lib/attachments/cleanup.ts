import { readdir } from "node:fs/promises";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { transactionAttachments } from "@/db/schema";
import { assertWithinAttachmentsDir, attachmentsDir, deleteAttachmentFile } from "./storage";

const ENC_RE = /^([0-9a-f-]{36})\.enc$/i;

/** Delete `.enc` files in the active profile's attachments directory that no
 *  longer have a `transaction_attachments` row. Rows disappear by cascade
 *  whenever a transaction is deleted, so every transaction-delete path calls
 *  this afterwards. Staging `.tmp` files and the health probe never match. */
export async function sweepOrphanAttachmentFiles(): Promise<{ removed: number }> {
  const dir = assertWithinAttachmentsDir(attachmentsDir());
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { removed: 0 };
    throw e;
  }
  const ids = names.map((n) => ENC_RE.exec(n)?.[1]).filter((id): id is string => !!id);
  const live = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({ id: transactionAttachments.id })
      .from(transactionAttachments)
      .where(inArray(transactionAttachments.id, ids.slice(i, i + 500)));
    for (const r of rows) live.add(r.id);
  }
  let removed = 0;
  for (const id of ids) {
    if (live.has(id)) continue;
    await deleteAttachmentFile(id);
    removed++;
  }
  return { removed };
}

/** Best-effort wrapper for delete routes: never fail the delete itself. */
export async function sweepOrphanAttachmentFilesQuietly(): Promise<void> {
  try {
    const { removed } = await sweepOrphanAttachmentFiles();
    if (removed) console.log(`[attachments] removed ${removed} orphaned file(s)`);
  } catch (e) {
    console.error("[attachments] orphan sweep failed:", e);
  }
}
