"use client";

import { useRef } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { Camera, FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { useSwrJson } from "@/hooks/use-swr-json";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { formatDate } from "@/lib/utils";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { DROPZONE_ACCEPT, MAX_UPLOAD_BYTES, formatFileSize } from "@/lib/attachments/constants";

/** Inline receipt-management panel for the expanded transaction
 *  row. Lists existing attachments (one line each: thumbnail OR
 *  file icon + filename + size + delete), plus a dropzone / "Add
 *  file" button for uploads. Hits
 *  POST /api/transactions/[id]/attachments per file and
 *  mutates the sibling SWR cache so the hover-preview on the row
 *  updates in-place (and the parent `refresh` call reloads the
 *  transactions list so the paper-clip icon count stays accurate).
 *
 *  25 MiB cap per file, server-side; client-side pre-check
 *  surfaces a toast before the POST so very large files don't
 *  tie up the browser's upload buffer. */

interface AttachmentRow {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  createdAt: string;
}

export function AttachmentPanel({
  transactionId,
  onChanged,
}: {
  transactionId: string;
  /** Fires after a successful upload or delete. The parent passes
   *  its SWR `mutate` so the transactions list re-fans and the
   *  paper-clip count on the row updates. */
  onChanged?: () => void;
}) {
  const { data, mutate } = useSwrJson<{ attachments: AttachmentRow[] }>(
    `/api/transactions/${transactionId}/attachments`,
  );
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const { uploading, uploadFiles } = useAttachmentUpload(transactionId, () => {
    void mutate();
    onChanged?.();
  });

  async function remove(id: string, filename: string) {
    const ok = await confirm({
      title: "Delete attachment?",
      description: `${filename} will be permanently removed from the transaction.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    const res = await fetch(
      `/api/transactions/${transactionId}/attachments/${id}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? `Delete failed (${res.status})`);
      return;
    }
    await mutate();
    onChanged?.();
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => void uploadFiles(files),
    accept: DROPZONE_ACCEPT,
    maxSize: MAX_UPLOAD_BYTES,
    multiple: true,
  });

  const attachments = data?.attachments ?? [];

  return (
    <div className="flex flex-col gap-2">
      {attachments.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((a) => (
            <AttachmentListRow
              key={a.id}
              row={a}
              transactionId={transactionId}
              onDelete={() => void remove(a.id, a.filename)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No receipts attached. Drop a file below or pick one from your
          computer.
        </p>
      )}
      <div className="flex items-stretch gap-1.5">
        <div
          {...getRootProps()}
          className={`flex-1 flex items-center justify-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs cursor-pointer transition-colors ${
            isDragActive
              ? "border-primary bg-primary/5 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted/50"
          } ${uploading > 0 ? "opacity-70 pointer-events-none" : ""}`}
          aria-label="Attach receipt"
        >
          <input {...getInputProps()} />
          <Upload className="h-3.5 w-3.5" />
          <span>
            {uploading > 0
              ? `Uploading ${uploading} file${uploading === 1 ? "" : "s"}…`
              : isDragActive
                ? "Drop to attach"
                : "Drop a receipt or click to attach (JPG · PNG · WEBP · HEIC · PDF · up to 25 MB)"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={uploading > 0}
          aria-label="Take photo"
          title="Take a photo with the device camera"
          className={`shrink-0 flex items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs
            border-border text-muted-foreground hover:bg-muted/50 transition-colors
            ${uploading > 0 ? "opacity-70 pointer-events-none" : ""}`}
        >
          <Camera className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Take photo</span>
        </button>
        {/* Separate hidden input so `capture="environment"` routes
            straight to the back camera on mobile. Desktop browsers
            that don't honour `capture` fall back to the normal image
            picker, which is still the right behaviour. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void uploadFiles(files);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

function AttachmentListRow({
  row,
  transactionId,
  onDelete,
}: {
  row: AttachmentRow;
  transactionId: string;
  onDelete: () => void;
}) {
  const sizeLabel = formatFileSize(row.size);
  const isImage = row.contentType.startsWith("image/");
  const Icon = isImage ? ImageIcon : FileText;
  return (
    <li className="flex items-center gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <a
        href={`/api/transactions/${transactionId}/attachments/${row.id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 truncate hover:underline"
        title={row.filename}
      >
        {row.filename}
      </a>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {sizeLabel}
      </span>
      <span className="shrink-0 text-muted-foreground/70 text-[10px]">
        {formatDate(row.createdAt)}
      </span>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 p-0.5 text-muted-foreground hover:text-destructive transition-colors"
        aria-label={`Delete ${row.filename}`}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
