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
  scheduledId: string;
  notes: string | null;
  /** Called after a successful save so the parent can re-render
   *  the icon colour from the fresh value. */
  onSaved?: (next: string | null) => void;
}

/** Popover-based notes editor for scheduled / budget rows on
 *  `/scheduled`. Icon-only trigger: muted when empty, indigo when
 *  the row carries a note. Click to open; the popover hosts a
 *  textarea + Save / Cancel buttons. Mirrors the row's existing
 *  hover-only chrome but stays open while the user types — we
 *  don't trigger save on blur so click-outside-to-dismiss reverts
 *  uncommitted edits.
 *
 *  Empty save (whitespace-only) writes `null` to the column so the
 *  icon flips back to its muted state. */
export function ScheduledNotesPopover({ scheduledId, notes, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [saving, setSaving] = useState(false);

  // Reset draft whenever the row's saved value changes (re-fetch
  // after a sibling edit, etc.). Only when closed — don't yank an
  // in-flight draft out from under the user.
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
    const res = await fetch(`/api/scheduled/${scheduledId}`, {
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
    onSaved?.(next);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // Hover-only on lg+ (matches the row's delete button);
          // always visible when a note is attached so the operator
          // can see at-a-glance that a row has detail.
          hasNote
            ? "opacity-100 text-indigo-500 hover:text-indigo-600"
            : "lg:opacity-0 lg:group-hover:opacity-100 text-muted-foreground hover:text-foreground",
          "transition-colors transition-opacity p-1 rounded hover:bg-muted",
        )}
        title={hasNote ? `Note: ${notes}` : "Add a note"}
        aria-label={hasNote ? "Edit note" : "Add note"}
      >
        <StickyNote className="h-3.5 w-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
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
          placeholder="Why does this schedule exist? Anything to watch for?"
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
