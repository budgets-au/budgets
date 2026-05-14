"use client";

import { useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Save, Trash2, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { newId } from "@/lib/new-id";
import { toast } from "sonner";

/** Saved-filter dropdown for the transactions list. Captures the
 * current URL search params under a name; the user can later restore
 * one with a click. Storage is on the DB-backed displayPrefs blob so
 * the same operator gets the same presets across devices. */
export function SavedFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { prefs, setPref } = useDisplayPrefs();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  // Source the typed name from a DOM ref rather than `name` state
  // at save time. Some interaction paths (Playwright fill, some
  // IME compositions) write the value via the native setter and
  // dispatch an `input` event React doesn't always pick up — the
  // controlled state lags the DOM. Reading from the ref at submit
  // sidesteps the inconsistency.
  const nameInputRef = useRef<HTMLInputElement>(null);
  const presets = prefs.transactionsSavedFilters;
  const currentQuery = searchParams.toString();

  function applyPreset(query: string) {
    router.replace(query ? `${pathname}?${query}` : pathname);
    setOpen(false);
  }

  function saveCurrent() {
    // Read from the DOM rather than controlled state — see ref
    // declaration above for the rationale.
    const raw = nameInputRef.current?.value ?? name;
    const trimmed = raw.trim();
    if (!trimmed) {
      toast.error("Give the filter a name");
      return;
    }
    // Reuse an existing preset's id when names collide so the user
    // can overwrite their own presets without piling up duplicates.
    const existing = presets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    const id = existing?.id ?? newId();
    const next = [
      ...presets.filter((p) => p.id !== id),
      { id, name: trimmed, query: currentQuery },
    ].sort((a, b) => a.name.localeCompare(b.name));
    setPref("transactionsSavedFilters", next);
    setName("");
    setNaming(false);
    toast.success(existing ? "Filter updated" : "Filter saved");
  }

  function removePreset(id: string) {
    setPref(
      "transactionsSavedFilters",
      presets.filter((p) => p.id !== id),
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Saved filters"
            aria-label="Saved filters"
            className="inline-flex items-center gap-1 px-3 py-2 text-sm border rounded-md bg-background hover:bg-muted transition-colors"
          />
        }
      >
        <Bookmark className="h-3.5 w-3.5" />
        <span>Saved</span>
        {presets.length > 0 && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {presets.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Saved filters
          </span>
          {!naming && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setNaming(true)}
            >
              <Save className="h-3 w-3 mr-1" /> Save current
            </Button>
          )}
        </div>
        {naming && (
          // Plain HTML form + plain <button>s. Earlier variants
          // (base-ui Input's onKeyDown, base-ui Button's onClick,
          // and a form wrapped around them) all somehow lost the
          // save action — best guess: base-ui's Popover Dismiss
          // plugin or Input primitive was eating the events.
          // Going native sidesteps the whole question.
          <form
            className="px-3 py-2 border-b space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              saveCurrent();
            }}
            onClick={(e) => {
              // base-ui's Popover dismisses on outside clicks; if
              // the popup's containment check misses our button
              // (children portal off the popup root), the click
              // gets read as outside and closes the popover before
              // onSubmit fires. Stop the bubble so the Dismiss
              // handler never sees it.
              e.stopPropagation();
            }}
          >
            <input
              ref={nameInputRef}
              autoFocus
              type="text"
              defaultValue=""
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setNaming(false);
                  setName("");
                  if (nameInputRef.current) nameInputRef.current.value = "";
                }
              }}
              placeholder="Name this filter…"
              aria-label="Filter name"
              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/50"
            />
            <div className="flex gap-1.5 justify-end">
              <button
                type="button"
                className="h-6 px-2 text-xs rounded-md hover:bg-muted transition-colors"
                onClick={() => {
                  setNaming(false);
                  setName("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveCurrent()}
                className="h-6 px-2 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/80 transition-colors"
              >
                Save
              </button>
            </div>
          </form>
        )}
        {presets.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground italic">
            No saved filters yet. Tune your filters above, then{" "}
            <strong>Save current</strong>.
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto py-1">
            {presets.map((p) => (
              <li
                key={p.id}
                className="group flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted cursor-pointer"
                onClick={() => applyPreset(p.query)}
              >
                <span className="truncate flex-1 min-w-0">{p.name}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePreset(p.id);
                  }}
                  className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-background"
                  aria-label={`Delete filter ${p.name}`}
                  title="Delete preset"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {currentQuery && (
          <div className="px-3 py-2 border-t flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="truncate">Current: {currentQuery}</span>
            <button
              type="button"
              onClick={() => router.replace(pathname)}
              title="Clear all filters"
              className="ml-2 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
