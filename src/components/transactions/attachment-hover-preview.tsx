"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Paperclip, Trash2, Upload } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSwrJson } from "@/hooks/use-swr-json";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface AttachmentRow {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
];
const ACCEPT_ATTR = ALLOWED_TYPES.join(",");

/** Paper-clip row-level affordance for receipt attachments.
 *
 *  Always visible — muted when the row has no attachments, normal
 *  when it has one or more — so the attach action is discoverable
 *  without expanding the row. Hover opens a Popover that:
 *   - lists the existing attachments as clickable tiles
 *     (160px image thumbs; filename / icon tiles for PDFs), and
 *   - carries a `+ Attach receipt` button at the bottom that opens
 *     the native file picker and POSTs each chosen file to
 *     `/api/transactions/[id]/attachments`.
 *
 *  SWR for the attachment list is gated on `isOpen`, so scrolling
 *  past a long transactions list doesn't fire N parallel requests.
 *  After a successful upload the sibling SWR cache mutates in place
 *  and `onChanged?.()` tells the parent list to re-fetch so the
 *  `attachmentCount` on the row (and the `×N` count badge next to
 *  the clip) reflects the new value immediately. */
export function AttachmentHoverPreview({
  transactionId,
  count,
  onChanged,
}: {
  transactionId: string;
  count: number;
  /** Called after a successful upload so the parent transactions
   *  list can re-fetch (`attachmentCount` on the row needs to
   *  reflect the new file). */
  onChanged?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  // Open/close debounce so a quick cursor pass over the icon doesn't
  // flicker the popover, and so moving icon → popover body doesn't
  // close before the pointer bridges the gap.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function openAfterDelay() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsOpen(true), 200);
  }
  function closeAfterDelay() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsOpen(false), 120);
  }

  // Only populate the SWR key once the popover has opened; a null
  // key tells SWR to skip the fetch entirely. The subsequent hover
  // re-uses the cache for the browser session.
  const { data, mutate } = useSwrJson<{ attachments: AttachmentRow[] }>(
    isOpen ? `/api/transactions/${transactionId}/attachments` : null,
  );

  const hasAttachments = count > 0;
  const label = !hasAttachments
    ? "Attach receipt"
    : count === 1
      ? "1 attachment"
      : `${count} attachments`;

  async function uploadFiles(files: File[]) {
    const accepted: File[] = [];
    for (const f of files) {
      if (f.size === 0) {
        toast.error(`${f.name}: file is empty`);
        continue;
      }
      if (f.size > MAX_UPLOAD_BYTES) {
        toast.error(`${f.name}: exceeds 25 MB upload cap`);
        continue;
      }
      if (!ALLOWED_TYPES.includes(f.type)) {
        toast.error(`${f.name}: unsupported file type (${f.type || "unknown"})`);
        continue;
      }
      accepted.push(f);
    }
    if (accepted.length === 0) return;

    setUploading((n) => n + accepted.length);
    try {
      for (const f of accepted) {
        const form = new FormData();
        form.append("file", f);
        const res = await fetch(
          `/api/transactions/${transactionId}/attachments`,
          { method: "POST", body: form },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          toast.error(
            `${f.name}: ${body.error ?? `upload failed (${res.status})`}`,
          );
          continue;
        }
        toast.success(`Attached ${f.name}`);
      }
      await mutate();
      onChanged?.();
    } finally {
      setUploading(0);
    }
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  async function remove(id: string, filename: string) {
    const ok = await confirm({
      title: "Delete attachment?",
      description: `${filename} will be permanently removed from the transaction.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/transactions/${transactionId}/attachments/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Delete failed (${res.status})`);
        return;
      }
      toast.success(`Deleted ${filename}`);
      await mutate();
      onChanged?.();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <span
            className={cn(
              "inline-flex shrink-0 cursor-help items-center gap-0.5 transition-colors p-0.5 rounded hover:bg-muted",
              hasAttachments
                ? "text-foreground/80 hover:text-foreground"
                : "text-muted-foreground/50 hover:text-foreground",
            )}
            aria-label={label}
            title={label}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={openAfterDelay}
            onMouseLeave={closeAfterDelay}
          />
        }
      >
        <Paperclip className="h-3 w-3" />
        {count > 1 && (
          <span className="text-[10px] font-medium tabular-nums leading-none">
            ×{count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={6}
        className="w-64 p-2 space-y-2"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={openAfterDelay}
        onMouseLeave={closeAfterDelay}
      >
        {hasAttachments ? (
          data === undefined ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : data.attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No attachments on this transaction.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.attachments.slice(0, 3).map((a) => (
                <li key={a.id} className="relative group/row">
                  <a
                    href={`/api/transactions/${transactionId}/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block"
                  >
                    <AttachmentTile row={a} transactionId={transactionId} />
                  </a>
                  <button
                    type="button"
                    onClick={(e) => {
                      // Overlaid on top of the open-file <a> — stop the
                      // click from reaching the link so the file doesn't
                      // open in a new tab mid-delete-confirm.
                      e.preventDefault();
                      e.stopPropagation();
                      void remove(a.id, a.filename);
                    }}
                    disabled={deletingId === a.id}
                    aria-label={`Delete ${a.filename}`}
                    title="Delete attachment"
                    className={cn(
                      "absolute top-1 right-1 rounded-md bg-background/85 backdrop-blur-sm border border-border/60 p-1",
                      "text-muted-foreground hover:text-destructive hover:border-destructive/60",
                      "transition-colors",
                      // Hover-reveal on desktop so the thumbnail stays
                      // the dominant visual; always visible on touch
                      // viewports where there's no hover state at all.
                      "lg:opacity-0 lg:group-hover/row:opacity-100 lg:focus-visible:opacity-100",
                      deletingId === a.id && "opacity-70 pointer-events-none",
                    )}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
              {data.attachments.length > 3 && (
                <li className="text-[11px] text-muted-foreground px-1">
                  + {data.attachments.length - 3} more
                </li>
              )}
            </ul>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            No receipts on this transaction yet.
          </p>
        )}
        <button
          type="button"
          onClick={openPicker}
          disabled={uploading > 0}
          className={cn(
            "w-full flex items-center justify-center gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-xs",
            "border-border text-muted-foreground hover:bg-muted/50 transition-colors",
            uploading > 0 && "opacity-70 pointer-events-none",
          )}
        >
          <Upload className="h-3 w-3" />
          <span>
            {uploading > 0
              ? `Uploading ${uploading}…`
              : hasAttachments
                ? "Attach another"
                : "Attach a receipt"}
          </span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) void uploadFiles(files);
            // Reset so the same file can be re-selected after a
            // mistake / cancel without the picker ignoring it.
            e.target.value = "";
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function AttachmentTile({
  row,
  transactionId,
}: {
  row: AttachmentRow;
  transactionId: string;
}) {
  const isImage = row.contentType.startsWith("image/");
  const sizeKb = Math.round(row.size / 1024);
  const sizeLabel = sizeKb < 1024 ? `${sizeKb} KB` : `${(sizeKb / 1024).toFixed(1)} MB`;

  if (isImage) {
    return (
      <div className="rounded-md border border-border/60 overflow-hidden group-hover:border-border transition-colors">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/transactions/${transactionId}/attachments/${row.id}`}
          alt={row.filename}
          className="w-full h-28 object-cover bg-muted"
          loading="lazy"
        />
        <div className="flex items-baseline justify-between gap-2 px-2 py-1 text-[11px] text-muted-foreground">
          <span className="truncate" title={row.filename}>
            {row.filename}
          </span>
          <span className="shrink-0 tabular-nums">{sizeLabel}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 p-2 group-hover:border-border transition-colors">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
      <div className="min-w-0 flex-1 text-xs">
        <div className="truncate font-medium" title={row.filename}>
          {row.filename}
        </div>
        <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{sizeLabel}</span>
          <span>·</span>
          <span>{formatDate(row.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
