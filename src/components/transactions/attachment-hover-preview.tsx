"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSwrJson } from "@/hooks/use-swr-json";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { formatFileSize, INPUT_ACCEPT } from "@/lib/attachments/constants";
import { cn, formatDate } from "@/lib/utils";

interface AttachmentRow {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
}

/** Shared trigger styling for the row-level icon buttons. The `after:`
 *  pseudo-element enlarges the hit area (≈32px, 44px on touch) without
 *  changing the row's layout. */
export const ROW_ICON_TRIGGER =
  "relative inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded p-0.5 transition-colors hover:bg-muted " +
  "after:absolute after:-inset-2.5 after:content-[''] pointer-coarse:after:-inset-4 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

/** Paper-clip affordance on every transaction row: muted with no receipts,
 *  normal with a `×N` badge when there are some. Hover/tap opens a popover with
 *  thumbnails, delete buttons and Take photo / Pick file.
 *
 *  The Popover is only mounted after the first hover, focus or tap, so long
 *  lists don't pay for thousands of popover roots. The file inputs live outside
 *  the popover so they can't be unmounted while the OS picker is open, and the
 *  popover is held open while a picker or upload is in progress. */
export function AttachmentHoverPreview({
  transactionId,
  count,
  onChanged,
}: {
  transactionId: string;
  count: number;
  onChanged?: () => void;
}) {
  const [active, setActive] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirm = useConfirm();

  const { data, mutate } = useSwrJson<{ attachments: AttachmentRow[] }>(
    isOpen ? `/api/transactions/${transactionId}/attachments` : null,
  );
  const { uploading, uploadFiles } = useAttachmentUpload(transactionId, () => {
    void mutate();
    onChanged?.();
  });
  const busy = picking || uploading > 0;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Clear `picking` when the OS picker is dismissed without a choice: the
  // input's native `cancel` event where supported, else the window regaining
  // focus (onChange, if any, fires first).
  useEffect(() => {
    if (!picking) return;
    const done = () => setPicking(false);
    const inputs = [fileInputRef.current, cameraInputRef.current];
    for (const i of inputs) i?.addEventListener("cancel", done);
    const onFocus = () => setTimeout(done, 500);
    window.addEventListener("focus", onFocus);
    return () => {
      for (const i of inputs) i?.removeEventListener("cancel", done);
      window.removeEventListener("focus", onFocus);
    };
  }, [picking]);

  // Hover-to-open is for mice only: a touch tap also fires emulated pointer
  // enter/leave, which raced the click and closed the popover on first tap.
  const hoverOnly = (fn: () => void) => (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") fn();
  };

  function setOpenGuarded(next: boolean) {
    if (!next && busyRef.current) return;
    setIsOpen(next);
  }
  function openAfterDelay() {
    setActive(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsOpen(true), 200);
  }
  function closeAfterDelay() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpenGuarded(false), 150);
  }
  function pick(input: HTMLInputElement | null) {
    if (!input) return;
    setPicking(true);
    input.click();
  }
  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    setPicking(false);
    if (files.length > 0) void uploadFiles(files);
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
      const res = await fetch(`/api/transactions/${transactionId}/attachments/${id}`, {
        method: "DELETE",
      });
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

  const hasAttachments = count > 0;
  const label = hasAttachments
    ? `${count} receipt${count === 1 ? "" : "s"} — show or add`
    : "Attach a receipt";
  const triggerClass = cn(
    ROW_ICON_TRIGGER,
    hasAttachments
      ? "text-foreground/80 hover:text-foreground"
      : "text-muted-foreground/50 hover:text-foreground",
  );
  const glyph = (
    <>
      <Paperclip className="h-3 w-3" />
      {count > 1 && (
        <span className="text-[10px] font-medium tabular-nums leading-none">×{count}</span>
      )}
    </>
  );

  const inputs = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={INPUT_ACCEPT}
        className="hidden"
        onChange={onPicked}
      />
      {/* capture="environment" opens the back camera directly on phones;
          desktop browsers fall back to an image picker. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPicked}
      />
    </>
  );

  if (!active) {
    return (
      <button
        type="button"
        className={triggerClass}
        aria-label={label}
        onPointerEnter={hoverOnly(openAfterDelay)}
        onClick={(e) => {
          e.stopPropagation();
          setActive(true);
          // Open after this click finishes, or the just-mounted popover
          // treats it as an outside press and closes again (first tap on
          // touch devices).
          setTimeout(() => setIsOpen(true), 0);
        }}
      >
        {glyph}
      </button>
    );
  }

  return (
    <>
      <Popover open={isOpen} onOpenChange={setOpenGuarded}>
        <PopoverTrigger
          className={triggerClass}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          onPointerEnter={hoverOnly(openAfterDelay)}
          onPointerLeave={hoverOnly(closeAfterDelay)}
        >
          {glyph}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          side="top"
          sideOffset={6}
          className="w-64 space-y-2 p-2"
          onClick={(e) => e.stopPropagation()}
          onPointerEnter={hoverOnly(openAfterDelay)}
          onPointerLeave={hoverOnly(closeAfterDelay)}
        >
          {!hasAttachments ? (
            <p className="text-xs text-muted-foreground">No receipts on this transaction yet.</p>
          ) : data === undefined ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : data.attachments.length === 0 ? (
            <p className="text-xs text-muted-foreground">No receipts on this transaction yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {data.attachments.slice(0, 3).map((a) => (
                <li key={a.id} className="group/row relative">
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
                      e.preventDefault();
                      e.stopPropagation();
                      void remove(a.id, a.filename);
                    }}
                    disabled={deletingId === a.id}
                    aria-label={`Delete ${a.filename}`}
                    className={cn(
                      "absolute right-1 top-1 rounded-md border border-border/60 bg-background/85 p-1.5 backdrop-blur-sm",
                      "text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive",
                      "lg:opacity-0 lg:focus-visible:opacity-100 lg:group-hover/row:opacity-100",
                      deletingId === a.id && "pointer-events-none opacity-70",
                    )}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
              {data.attachments.length > 3 && (
                <li className="px-1 text-[11px] text-muted-foreground">
                  + {data.attachments.length - 3} more — expand the row to see all
                </li>
              )}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { key: "camera", icon: Camera, text: "Take photo", input: cameraInputRef },
              { key: "file", icon: Upload, text: "Pick file", input: fileInputRef },
            ].map(({ key, icon: Icon, text, input }) => (
              <button
                key={key}
                type="button"
                onClick={() => pick(input.current)}
                disabled={uploading > 0}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-2 py-2 text-xs",
                  "text-muted-foreground transition-colors hover:bg-muted/50",
                  uploading > 0 && "pointer-events-none opacity-70",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{text}</span>
              </button>
            ))}
          </div>
          {uploading > 0 && (
            <p className="text-center text-[11px] text-muted-foreground">
              Uploading {uploading} file{uploading === 1 ? "" : "s"}…
            </p>
          )}
        </PopoverContent>
      </Popover>
      {inputs}
    </>
  );
}

function AttachmentTile({ row, transactionId }: { row: AttachmentRow; transactionId: string }) {
  const [broken, setBroken] = useState(false);
  const isImage = row.contentType.startsWith("image/") && !broken;
  const size = formatFileSize(row.size);

  if (isImage) {
    return (
      <div className="overflow-hidden rounded-md border border-border/60 transition-colors group-hover:border-border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/transactions/${transactionId}/attachments/${row.id}`}
          alt={row.filename}
          className="h-28 w-full bg-muted object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
        <div className="flex items-baseline justify-between gap-2 px-2 py-1 text-[11px] text-muted-foreground">
          <span className="truncate">{row.filename}</span>
          <span className="shrink-0 tabular-nums">{size}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 p-2 transition-colors group-hover:border-border">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-xs">
        <div className="truncate font-medium">{row.filename}</div>
        <div className="flex flex-wrap items-baseline gap-x-2 whitespace-nowrap text-[11px] text-muted-foreground">
          <span className="tabular-nums">{size}</span>
          <span>{formatDate(row.createdAt)}</span>
          {row.contentType.startsWith("image/") && <span>no preview</span>}
        </div>
      </div>
    </div>
  );
}
