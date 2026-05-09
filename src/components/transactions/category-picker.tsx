"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { buildCategoryMeta } from "@/lib/category-path";

interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

interface FilterEntry {
  id: string;
  path: string[];
  haystack: string;
  /** "Grandparent / Parent / Child" pre-formatted for the dropdown row. */
  label: string;
}

export function CategoryPicker({
  transactionId,
  categoryId,
  categoryName,
  categories,
}: {
  transactionId: string;
  categoryId: string | null;
  categoryName: string | null;
  categories: Category[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(categoryId ?? "");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { meta } = useMemo(() => buildCategoryMeta(categories), [categories]);

  const triggerLabel = useMemo(() => {
    if (!value) return "Uncategorised";
    const m = meta.get(value);
    if (!m) return categoryName ?? "Uncategorised";
    // Show only the leaf — the parent / grandparent context is in the
    // dropdown's per-row indented tree, not on the row itself, so the
    // trigger stays readable inside a narrow column. Falls back to
    // the full path only if the meta walk somehow produced an empty
    // array.
    return m.path[m.path.length - 1] ?? m.path.join(" / ");
  }, [value, meta, categoryName]);

  // Pre-compute the searchable corpus once per category set so each
  // keystroke is a cheap filter rather than re-walking the tree.
  const entries: FilterEntry[] = useMemo(() => {
    const list: FilterEntry[] = [];
    for (const c of categories) {
      const m = meta.get(c.id);
      if (!m) continue;
      const label = m.path.join(" / ");
      list.push({
        id: c.id,
        path: m.path,
        haystack: label.toLowerCase(),
        label,
      });
    }
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
  }, [categories, meta]);

  const filtered: FilterEntry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    // Score: prefix match on the leaf name beats prefix match on any
    // ancestor segment beats anywhere-substring. Within each tier, fall
    // back to alphabetical for a stable order.
    const scored = entries
      .map((e) => {
        let score = -1;
        const leaf = (e.path[e.path.length - 1] ?? "").toLowerCase();
        if (leaf.startsWith(q)) score = 0;
        else if (e.path.some((seg) => seg.toLowerCase().startsWith(q))) score = 1;
        else if (e.haystack.includes(q)) score = 2;
        return { e, score };
      })
      .filter((x) => x.score >= 0);
    scored.sort((a, b) => a.score - b.score || a.e.label.localeCompare(b.e.label));
    return scored.map((x) => x.e);
  }, [entries, query]);

  // Reset cursor when the filter changes so it always lands on the top match.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Focus the search input when the popover opens.
  useEffect(() => {
    if (open) {
      // setTimeout because the input only becomes focusable after the
      // popover finishes animating in.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setQuery("");
  }, [open]);

  // Keep the active row scrolled into view during arrow-key navigation.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  async function applyValue(newValue: string) {
    setValue(newValue);
    setOpen(false);
    const res = await fetch(`/api/transactions/${transactionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: newValue || null }),
    });
    if (!res.ok) {
      toast.error("Failed to update category");
      setValue(categoryId ?? "");
      return;
    }
    startTransition(() => router.refresh());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // +1 to account for the synthetic "Uncategorised" row at index 0.
    const total = filtered.length + 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % total);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + total) % total);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx === 0) {
        applyValue("");
      } else {
        const pick = filtered[activeIdx - 1];
        if (pick) applyValue(pick.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="h-6 text-xs px-1 gap-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded inline-flex items-center justify-between min-w-0 max-w-full disabled:opacity-50"
        disabled={pending}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-0 gap-0 overflow-hidden"
      >
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search categories…"
            className="h-7 text-xs"
          />
        </div>
        <ul
          ref={listRef}
          className="max-h-72 overflow-y-auto py-1"
          role="listbox"
        >
          {/* Synthetic "Uncategorised" row, always at the top. */}
          <li
            data-idx={0}
            role="option"
            aria-selected={!value}
            onMouseEnter={() => setActiveIdx(0)}
            onClick={() => applyValue("")}
            className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer ${
              activeIdx === 0 ? "bg-muted" : ""
            }`}
          >
            <Check
              className={`h-3 w-3 shrink-0 ${!value ? "opacity-100" : "opacity-0"}`}
            />
            <span className="text-muted-foreground italic">Uncategorised</span>
          </li>
          {filtered.length === 0 && query.trim().length > 0 && (
            <li className="px-2 py-2 text-xs text-muted-foreground italic">
              No matches.
            </li>
          )}
          {filtered.map((e, i) => {
            const idx = i + 1;
            const isActive = idx === activeIdx;
            const isSelected = value === e.id;
            const segs = e.path;
            return (
              <li
                key={e.id}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => applyValue(e.id)}
                className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer min-w-0 ${
                  isActive ? "bg-muted" : ""
                }`}
                title={e.label}
              >
                <Check
                  className={`h-3 w-3 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`}
                />
                <span className="truncate min-w-0">
                  {segs.length > 1 && (
                    <span className="text-muted-foreground/70">
                      {segs.slice(0, -1).join(" / ")}
                      {" / "}
                    </span>
                  )}
                  <span>{segs[segs.length - 1]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
