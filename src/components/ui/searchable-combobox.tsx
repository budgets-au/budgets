"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

export interface ComboboxItem {
  /** Stable identifier — matched against `value`. */
  id: string;
  /** Visible leaf label, rendered bold. */
  label: string;
  /** Optional path segments shown muted before the label
   * ("Food / Groceries"). Use for hierarchical lists. */
  ancestors?: string[];
  /** Render the label in muted italics — used for sentinel rows
   * ("Uncategorised", "All Accounts"). */
  italic?: boolean;
  /** Optional override for the search corpus. Defaults to label +
   * ancestors joined with " / ". */
  searchText?: string;
}

export interface SearchableComboboxProps {
  value: string;
  onChange: (id: string) => void;
  items: ComboboxItem[];
  /** Pinned at the top of the list, above the searchable items. Useful
   * for "All X" or "Uncategorised" sentinels — these still match a
   * search query so they're filterable. */
  pinnedItems?: ComboboxItem[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Trigger label when no value matches any item (e.g. value="" and no
   * pinned id="" entry exists). */
  emptyTriggerLabel?: string;
  triggerClassName?: string;
  popoverClassName?: string;
  disabled?: boolean;
}

interface ScoredItem {
  item: ComboboxItem;
  isPinned: boolean;
  score: number;
  haystack: string;
  display: string;
}

function pathDisplay(item: ComboboxItem): string {
  return item.ancestors && item.ancestors.length > 0
    ? `${item.ancestors.join(" / ")} / ${item.label}`
    : item.label;
}

function haystackOf(item: ComboboxItem): string {
  return (item.searchText ?? pathDisplay(item)).toLowerCase();
}

export function SearchableCombobox({
  value,
  onChange,
  items,
  pinnedItems = [],
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyMessage = "No matches.",
  emptyTriggerLabel,
  triggerClassName,
  popoverClassName,
  disabled,
}: SearchableComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const allItems = useMemo(
    () => [
      ...pinnedItems.map((it) => ({ ...it, _pinned: true })),
      ...items.map((it) => ({ ...it, _pinned: false })),
    ],
    [pinnedItems, items],
  );

  const filtered: ScoredItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: ScoredItem[] = [];
    for (const it of allItems) {
      const haystack = haystackOf(it);
      const display = pathDisplay(it);
      if (!q) {
        out.push({
          item: it,
          isPinned: it._pinned,
          score: it._pinned ? -1 : 0,
          haystack,
          display,
        });
        continue;
      }
      const leaf = it.label.toLowerCase();
      let score = -1;
      if (leaf.startsWith(q)) score = 0;
      else if ((it.ancestors ?? []).some((s) => s.toLowerCase().startsWith(q)))
        score = 1;
      else if (haystack.includes(q)) score = 2;
      // Pinned items always show when matched, but score them above
      // search hits so the user can still pick the sentinel quickly.
      if (it._pinned && score === -1) {
        // Pinned with no query match → still show, scored above
        // unmatched items so they remain reachable.
        out.push({
          item: it,
          isPinned: true,
          score: 99,
          haystack,
          display,
        });
        continue;
      }
      if (score < 0) continue;
      out.push({
        item: it,
        isPinned: it._pinned,
        score: it._pinned ? -1 : score,
        haystack,
        display,
      });
    }
    out.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.score !== b.score) return a.score - b.score;
      return a.display.localeCompare(b.display);
    });
    return out;
  }, [allItems, query]);

  // Cursor resets to the top match whenever the filter changes.
  useEffect(() => {
    setActiveIdx(0);
  }, [query, filtered.length]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setQuery("");
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list
      .querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  function applyValue(id: string) {
    onChange(id);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (filtered.length === 0 ? 0 : (i + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) =>
        filtered.length === 0 ? 0 : (i - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = filtered[activeIdx];
      if (pick) applyValue(pick.item.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  // Resolve the trigger label: prefer matching item's full path; fall
  // back to pinned match; otherwise the emptyTriggerLabel/placeholder.
  const triggerLabel = useMemo(() => {
    const match =
      items.find((i) => i.id === value) ??
      pinnedItems.find((i) => i.id === value);
    if (match) return pathDisplay(match);
    return emptyTriggerLabel ?? placeholder;
  }, [value, items, pinnedItems, emptyTriggerLabel, placeholder]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        className={
          triggerClassName ??
          "text-sm border rounded-md px-3 py-2 bg-background h-auto min-w-[150px] w-auto inline-flex items-center justify-between gap-2 disabled:opacity-50"
        }
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={popoverClassName ?? "w-72 p-0 gap-0 overflow-hidden"}
      >
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={searchPlaceholder}
            className="h-7 text-xs"
          />
        </div>
        <ul
          ref={listRef}
          className="max-h-72 overflow-y-auto py-1"
          role="listbox"
        >
          {filtered.length === 0 && (
            <li className="px-2 py-2 text-xs text-muted-foreground italic">
              {emptyMessage}
            </li>
          )}
          {filtered.map((row, i) => {
            const it = row.item;
            const selected = it.id === value;
            const active = i === activeIdx;
            return (
              <li
                key={`${row.isPinned ? "pin:" : ""}${it.id}`}
                data-idx={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => applyValue(it.id)}
                className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer min-w-0 ${
                  active ? "bg-muted" : ""
                }`}
                title={row.display}
              >
                <Check
                  className={`h-3 w-3 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                />
                <span
                  className={`truncate min-w-0 ${
                    it.italic ? "italic text-muted-foreground" : ""
                  }`}
                >
                  {it.ancestors && it.ancestors.length > 0 && (
                    <span className="text-muted-foreground/70">
                      {it.ancestors.join(" / ")} /{" "}
                    </span>
                  )}
                  <span>{it.label}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
