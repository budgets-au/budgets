"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  transactionId: string;
  notes: string | null;
  /** Called after a successful save so the parent can re-fetch and
   *  re-render the row with the fresh notes value. */
  onSaved?: () => void;
}

/** Icon-trigger notes editor for the collapsed transactions row.
 *  Mirrors `scheduled-notes-popover.tsx` on `/scheduled`: the
 *  StickyNote icon is always visible (muted when the row carries no
 *  note, amber when it does) so operators can discover the
 *  affordance without expanding the row. Click opens a popover with
 *  a textarea + Save / Cancel. An empty save writes `null` to the
 *  column so the icon flips back to its muted state.
 *
 *  Lives beside `attachment-hover-preview.tsx` — both are
 *  always-rendered row-level affordances the operator can act on
 *  without first expanding the row. */
export function TransactionNotesPopover({
  transactionId,
  notes,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  // Keep the draft in sync with upstream saved value whenever the
  // popover is closed; don't yank an in-flight edit out from under
  // the operator while they're typing.
  useEffect(() => {
    if (!open) setValue(notes ?? "");
  }, [notes, open]);

  const hasNote = !!(notes && notes.trim().length > 0);

  async function save() {
    const next = value.trim() === "" ? null : value;
    const current = notes ?? null;
    if (next === current) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/transactions/${transactionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: next }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error("Failed to save note");
      return;
    }
    setOpen(false);
    onSaved?.();
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          hasNote
            ? "text-amber-500 hover:text-amber-600"
            : "text-muted-foreground/50 hover:text-foreground",
          "inline-flex shrink-0 items-center transition-colors p-0.5 rounded hover:bg-muted",
        )}
        title={hasNote ? `Note: ${notes}` : "Add a note"}
        aria-label={hasNote ? "Edit note" : "Add note"}
      >
        <StickyNote className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3 space-y-2"
        onClick={(e) => e.stopPropagation()}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setValue(notes ?? "");
              setOpen(false);
            } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          rows={4}
          placeholder="Add a note about this transaction…"
          autoFocus
          className="w-full text-sm bg-background border border-input rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 resize-y"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            ⌘/Ctrl+Enter to save · Esc to cancel
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setValue(notes ?? "");
                setOpen(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
