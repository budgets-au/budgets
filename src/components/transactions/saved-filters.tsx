"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Bookmark, Save, Trash2, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
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

  const presets = prefs.transactionsSavedFilters;
  const currentQuery = searchParams.toString();

  function applyPreset(query: string) {
    router.replace(query ? `${pathname}?${query}` : pathname);
    setOpen(false);
  }

  function saveCurrent() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the filter a name");
      return;
    }
    // Reuse an existing preset's id when names collide so the user
    // can overwrite their own presets without piling up duplicates.
    const existing = presets.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
    const id = existing?.id ?? crypto.randomUUID();
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
          <div className="px-3 py-2 border-b space-y-2">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveCurrent();
                else if (e.key === "Escape") {
                  setNaming(false);
                  setName("");
                }
              }}
              placeholder="Name this filter…"
              className="h-7 text-xs"
            />
            <div className="flex gap-1.5 justify-end">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setNaming(false);
                  setName("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={saveCurrent}
              >
                Save
              </Button>
            </div>
          </div>
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
