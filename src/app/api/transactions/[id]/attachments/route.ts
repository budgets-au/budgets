import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { transactions, transactionAttachments } from "@/db/schema";
import { withAuth } from "@/lib/api/route-guards";
import { AttachmentKeyMissingError, ensureDek, encryptBytes } from "@/lib/attachments/crypto";
import { sniffReceiptType } from "@/lib/attachments/sniff";
import { ALLOWED_TYPES, MAX_UPLOAD_BYTES } from "@/lib/attachments/constants";
import {
  ensureAttachmentsDir,
  writeAttachmentAtomic,
} from "@/lib/attachments/storage";

/** GET /api/transactions/[id]/attachments
 *  — list every attachment on a transaction. The paper-clip row
 *    icon + hover preview on the transactions list calls this
 *    lazily (on hover) rather than eagerly on list render.
 *
 *  POST /api/transactions/[id]/attachments
 *  — multipart upload of ONE file (field name `file`). AES-256-GCM
 *    encrypts under the DEK + writes to disk + inserts a metadata
 *    row. Call again to add more; multiple attachments per
 *    transaction are supported.
 *
 *  25 MiB cap per file. Allowed types: image/jpeg, image/png,
 *  image/webp, image/heic, image/heif, application/pdf. Everything
 *  else is 415. */


const uuidSchema = z.string().uuid();

export const GET = withAuth<{ params: Promise<{ id: string }> }>(
  async (_request, ctx) => {
    const { id: raw } = await ctx.params;
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid transaction id" }, { status: 400 });
    }
    const txnId = parsed.data;

    // Confirm the transaction exists — surfaces as 404 so the client
    // can distinguish "no attachments" (empty list) from "no txn".
    const [txn] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, txnId))
      .limit(1);
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        id: transactionAttachments.id,
        filename: transactionAttachments.filename,
        contentType: transactionAttachments.contentType,
        size: transactionAttachments.size,
        sha256: transactionAttachments.sha256,
        createdAt: transactionAttachments.createdAt,
      })
      .from(transactionAttachments)
      .where(eq(transactionAttachments.transactionId, txnId))
      .orderBy(transactionAttachments.createdAt);

    return NextResponse.json({ attachments: rows });
  },
);

export const POST = withAuth<{ params: Promise<{ id: string }> }>(
  async (request, ctx) => {
    try {
      return await handleUpload(request, ctx);
    } catch (e) {
      if (e instanceof AttachmentKeyMissingError) {
        return NextResponse.json({ error: e.message }, { status: 409 });
      }
      // Last-line catch: always return a readable body, but keep SQL / OS
      // detail in the server log rather than the response.
      console.error("[attachments] upload failed with unexpected error", e);
      const msg = e instanceof Error ? e.message : String(e);
      const schema = /no such table|no such column/i.test(msg);
      return NextResponse.json(
        {
          error: schema
            ? "Upload failed: the database schema is out of date. See Settings → Maintenance → Schema check."
            : "Upload failed due to a server error. Check the server log for details.",
          code: schema ? "SCHEMA_MISMATCH" : "UPLOAD_FAILED",
        },
        { status: 500 },
      );
    }
  },
);

async function handleUpload(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
    const { id: raw } = await ctx.params;
    const parsed = uuidSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid transaction id" }, { status: 400 });
    }
    const txnId = parsed.data;

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Content-Type must be multipart/form-data" },
        { status: 400 },
      );
    }

    // Confirm the transaction exists before processing the body so a
    // bad id doesn't waste a 25 MiB upload parse.
    const [txn] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.id, txnId))
      .limit(1);
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing 'file' field" },
        { status: 400 },
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${MAX_UPLOAD_BYTES}-byte cap` },
        { status: 413 },
      );
    }
    // The browser's declared type is untrusted (and empty for .heic on some
    // platforms); classify by content and store the sniffed type.
    const plaintext = Buffer.from(await file.arrayBuffer());
    const sniffedType = sniffReceiptType(plaintext);
    if (!sniffedType) {
      return NextResponse.json(
        {
          error: "Unsupported file: receipts must be a JPEG, PNG, WebP, HEIC or PDF.",
          allowed: ALLOWED_TYPES,
        },
        { status: 415 },
      );
    }
    const sha256 = createHash("sha256").update(plaintext).digest("hex");

    const dek = await ensureDek();
    const encrypted = encryptBytes(plaintext, dek);

    try {
      await ensureAttachmentsDir();
    } catch (e) {
      // Most common failure: the volume isn't mounted, or the
      // container user can't write to it (EACCES after root-owned
      // chown is forgotten). Surface the OS error code + a hint so
      // the operator can act — the opaque 500 the earlier version
      // returned told them nothing.
      console.error("[attachments] failed to create storage dir", e);
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      const hint =
        code === "EACCES"
          ? " (permission denied — chown the mount to the app user)"
          : code === "EROFS"
            ? " (read-only filesystem)"
            : code === "ENOENT"
              ? " (path doesn't exist — declare the mount or set ATTACHMENTS_PATH)"
              : code === "ENOSPC"
                ? " (disk full)"
                : "";
      return NextResponse.json(
        {
          error: `Attachments store isn't writable${hint}. Check Settings → Databases → Attachments store.`,
        },
        { status: 500 },
      );
    }

    // Insert the DB row first so we have the UUID for the on-disk
    // filename. If the file write fails after this, we clean up the
    // DB row — leaving an orphan file is better than leaving a DB
    // row that promises a file that isn't there.
    const [inserted] = await db
      .insert(transactionAttachments)
      .values({
        transactionId: txnId,
        filename: sanitiseFilename(file.name),
        contentType: sniffedType,
        size: plaintext.length,
        sha256,
      })
      .returning({
        id: transactionAttachments.id,
        filename: transactionAttachments.filename,
        contentType: transactionAttachments.contentType,
        size: transactionAttachments.size,
        sha256: transactionAttachments.sha256,
        createdAt: transactionAttachments.createdAt,
      });

    try {
      await writeAttachmentAtomic(inserted.id, encrypted);
    } catch (e) {
      // Roll back the DB row — the file never landed.
      await db
        .delete(transactionAttachments)
        .where(eq(transactionAttachments.id, inserted.id));
      console.error("[attachments] write failed, rolled back row", e);
      const code = (e as NodeJS.ErrnoException | undefined)?.code;
      const hint = code ? ` (${code})` : "";
      return NextResponse.json(
        {
          error: `Failed to write attachment to disk${hint}. Check Settings → Databases → Attachments store.`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ attachment: inserted }, { status: 201 });
}

/** Strip anything that looks like a path separator; cap length to
 *  255. Browsers rarely send problematic filenames, but validating
 *  on the server anyway is cheap. The filename is UI-only; the
 *  on-disk file is named after the attachment UUID. */
function sanitiseFilename(raw: string): string {
  const stripped = raw.replace(/[/\\\0]+/g, "_").trim();
  return stripped.slice(0, 255) || "attachment";
}
