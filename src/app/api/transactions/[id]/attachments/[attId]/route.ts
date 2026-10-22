import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { transactionAttachments } from "@/db/schema";
import { withAuth } from "@/lib/api/route-guards";
import { AttachmentKeyMissingError, ensureDek, readAndDecryptFile } from "@/lib/attachments/crypto";
import {
  attachmentsPathFor,
  deleteAttachmentFile,
} from "@/lib/attachments/storage";

/** GET /api/transactions/[id]/attachments/[attId]
 *  — stream the decrypted plaintext back. Content-Disposition is
 *    `inline` so the browser renders images/PDFs in-place for the
 *    preview popover + the attach-panel detail link; append
 *    `?download=1` to flip to `attachment` for Save-As.
 *
 *  DELETE /api/transactions/[id]/attachments/[attId]
 *  — remove the DB row + delete the on-disk file. Best-effort on
 *    the file side so an orphan stray from a prior crash can still
 *    be purged by delete.
 *
 *  Both guards: the attachment MUST belong to the parent `[id]`
 *  transaction. A caller who knows an attachment UUID but mismatches
 *  the parent txn id gets 404 — matches the shape of
 *  `withAuthAndId` wherever cross-id reaches would otherwise be
 *  possible. */

const uuidSchema = z.string().uuid();

function parseIds(
  raw: { id: string; attId: string },
): { txnId: string; attId: string } | { error: string } {
  const txnParsed = uuidSchema.safeParse(raw.id);
  if (!txnParsed.success) return { error: "Invalid transaction id" };
  const attParsed = uuidSchema.safeParse(raw.attId);
  if (!attParsed.success) return { error: "Invalid attachment id" };
  return { txnId: txnParsed.data, attId: attParsed.data };
}

export const GET = withAuth<{
  params: Promise<{ id: string; attId: string }>;
}>(async (request, ctx) => {
  const raw = await ctx.params;
  const parsed = parseIds(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { txnId, attId } = parsed;

  const [row] = await db
    .select({
      id: transactionAttachments.id,
      filename: transactionAttachments.filename,
      contentType: transactionAttachments.contentType,
      size: transactionAttachments.size,
    })
    .from(transactionAttachments)
    .where(
      and(
        eq(transactionAttachments.id, attId),
        eq(transactionAttachments.transactionId, txnId),
      ),
    )
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  let plaintext: Buffer;
  try {
    plaintext = await readAndDecryptFile(attachmentsPathFor(row.id), await ensureDek());
  } catch (e) {
    if (e instanceof AttachmentKeyMissingError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[attachments] decrypt failed", { id: row.id, err: e });
    return NextResponse.json(
      { error: "Failed to decrypt attachment" },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  // RFC 5987 filename encoding so UTF-8 filenames survive the hop.
  const filenameStar = `filename*=UTF-8''${encodeURIComponent(row.filename)}`;

  return new NextResponse(new Uint8Array(plaintext), {
    status: 200,
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(plaintext.length),
      "Content-Disposition": `${disposition}; ${filenameStar}`,
      // Private cache only — the response body is the operator's
      // encrypted ledger content and shouldn't be stored by shared
      // proxies.
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
});

export const DELETE = withAuth<{
  params: Promise<{ id: string; attId: string }>;
}>(async (_request, ctx) => {
  const raw = await ctx.params;
  const parsed = parseIds(raw);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { txnId, attId } = parsed;

  const result = await db
    .delete(transactionAttachments)
    .where(
      and(
        eq(transactionAttachments.id, attId),
        eq(transactionAttachments.transactionId, txnId),
      ),
    )
    .returning({ id: transactionAttachments.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  // Best-effort file delete — a missing file is fine, the row is
  // gone and the user won't see it again. Log for diagnostics in
  // case the directory went read-only.
  try {
    await deleteAttachmentFile(attId);
  } catch (e) {
    console.error("[attachments] file delete failed, row already gone", {
      id: attId,
      err: e,
    });
  }

  return NextResponse.json({ ok: true });
});
