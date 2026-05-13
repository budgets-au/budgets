"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronsUpDown, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { buildCategoryMeta } from "@/lib/category-path";

/** Minimal category shape every consumer already has on hand —
 * `type` is widened to `string` to absorb the drizzle row shape
 * (column is TEXT, no narrow union) without forcing every caller
 * to cast. The filter logic just does a string compare so the
 * union semantics still work at runtime. */
export interface CategoryLike {
  id: string;
  name: string;
  parentId: string | null;
  type?: string;
}

export interface CategoryDropdownProps {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  categories: CategoryLike[];

  /** Restrict the visible options to one type. Used by the
   * schedule + import flows where the transaction sign already
   * implies the answer. */
  typeFilter?: "income" | "expense";

  /** Skip these IDs (and, when `excludeDescendants` is on, their
   * descendants too). Category-manager's parent picker passes the
   * editing cat + its descendants so the user can't accidentally
   * create a cycle. */
  excludeIds?: string[];
  /** Default true. When false, only the literal ids are filtered;
   * descendants stay visible. */
  excludeDescendants?: boolean;

  /** Forbid options whose tree-depth exceeds this. 0 = root only,
   * 1 = root + child, 2 = the full three-level tree (the app's
   * current ceiling). */
  maxDepth?: number;

  /** Label for the "no category" sentinel row at the top of the
   * list. Set to null to omit the row entirely. */
  uncategorisedLabel?: string | null;

  /** Trigger button text when no value is selected. */
  placeholder?: string;

  /** Cosmetic. */
  triggerClassName?: string;
  popoverClassName?: string;
  disabled?: boolean;
}

interface Entry {
  id: string;
  depth: number;
  /** "Grandparent / Parent / Child" — used as the search corpus + the
   * tooltip on the row. The label rendered to the user is the
   * trailing leaf only; ancestor context is conveyed by indent. */
  fullPath: string;
  haystack: string;
  leaf: string;
}

const DEFAULT_TRIGGER_CLS =
  "h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground bg-background border rounded inline-flex items-center justify-between min-w-0 max-w-full disabled:opacity-50";

const DEFAULT_POPOVER_CLS = "w-72 p-0 gap-0 overflow-hidden";

/** Shared category picker. All inline-edit + form-field + import
 * surfaces lean on this so the UX (keyboard nav, indent-based
 * hierarchy, search scoring) is identical across the app. */
export function CategoryDropdown({
  value,
  onChange,
  categories,
  typeFilter,
  excludeIds,
  excludeDescendants = true,
  maxDepth,
  uncategorisedLabel = "Uncategorised",
  placeholder = "Pick a category…",
  triggerClassName,
  popoverClassName,
  disabled = false,
}: CategoryDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { meta } = useMemo(() => buildCategoryMeta(categories), [categories]);

  /** All visible categories (after type / exclude / maxDepth
   * filtering), pre-shaped for fast search. */
  const entries: Entry[] = useMemo(() => {
    // Build the exclusion closure — direct ids plus, when descendant
    // skipping is on, every cat whose ancestry includes one of them.
    const excludeSet = new Set(excludeIds ?? []);
    if (excludeDescendants && excludeSet.size > 0) {
      for (const c of categories) {
        let p = c.parentId;
        while (p) {
          if (excludeSet.has(p)) {
            excludeSet.add(c.id);
            break;
          }
          p = categories.find((x) => x.id === p)?.parentId ?? null;
        }
      }
    }

    const list: Entry[] = [];
    for (const c of categories) {
      if (excludeSet.has(c.id)) continue;
      if (typeFilter && c.type && c.type !== typeFilter) continue;
      const m = meta.get(c.id);
      if (!m) continue;
      if (typeof maxDepth === "number" && m.depth > maxDepth) continue;
      const fullPath = m.path.join(" / ");
      list.push({
        id: c.id,
        depth: m.depth,
        fullPath,
        haystack: fullPath.toLowerCase(),
        leaf: m.path[m.path.length - 1] ?? c.name,
      });
    }
    // Stable tree-order — sort by full path so depth-1 children sit
    // directly under their parent. Indent makes the grouping visible.
    list.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
    return list;
  }, [categories, meta, typeFilter, excludeIds, excludeDescendants, maxDepth]);

  const filtered: Entry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    // Score: leaf-prefix beats ancestor-prefix beats substring-anywhere.
    // Stable tiebreak on alphabetised full-path so adjacent siblings
    // stay grouped.
    const scored = entries
      .map((e) => {
        let score = -1;
        if (e.leaf.toLowerCase().startsWith(q)) score = 0;
        else if (
          e.fullPath
            .split(" / ")
            .some((seg) => seg.toLowerCase().startsWith(q))
        )
          score = 1;
        else if (e.haystack.includes(q)) score = 2;
        return { e, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.e.fullPath.localeCompare(b.e.fullPath));
    return scored.map((x) => x.e);
  }, [entries, query]);

  // Reset cursor when filter changes so it always lands on the top match.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Focus the search input when the popover opens.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    setQuery("");
  }, [open]);

  // Keep the active row scrolled into view during arrow-key navigation.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  // Sentinel sits at index 0 when present; entries occupy 1..N (or
  // 0..N-1 when sentinel is omitted).
  const hasSentinel = uncategorisedLabel !== null;
  const sentinelIdx = hasSentinel ? 0 : -1;
  const firstEntryIdx = hasSentinel ? 1 : 0;
  const totalRows = filtered.length + (hasSentinel ? 1 : 0);

  function apply(id: string | null) {
    onChange(id);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (totalRows === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % totalRows);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + totalRows) % totalRows);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hasSentinel && activeIdx === sentinelIdx) {
        apply(null);
      } else {
        const pick = filtered[activeIdx - firstEntryIdx];
        if (pick) apply(pick.id);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const triggerLabel = useMemo(() => {
    if (!value) return hasSentinel ? uncategorisedLabel : placeholder;
    const m = meta.get(value);
    if (!m) return placeholder;
    // Mirror the inline-edit picker: only the leaf shows on the
    // trigger so narrow column cells stay readable; the indent in
    // the popover communicates the hierarchy.
    return m.path[m.path.length - 1] ?? m.path.join(" / ");
  }, [value, meta, hasSentinel, uncategorisedLabel, placeholder]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={triggerClassName ?? DEFAULT_TRIGGER_CLS}
        disabled={disabled}
      >
        <span className="truncate">{triggerLabel}</span>
        <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={popoverClassName ?? DEFAULT_POPOVER_CLS}
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
          {hasSentinel && (
            <li
              data-idx={0}
              role="option"
              aria-selected={!value}
              onMouseEnter={() => setActiveIdx(0)}
              onClick={() => apply(null)}
              className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer ${
                activeIdx === 0 ? "bg-muted" : ""
              }`}
            >
              <Check
                className={`h-3 w-3 shrink-0 ${!value ? "opacity-100" : "opacity-0"}`}
              />
              <span className="text-muted-foreground italic">
                {uncategorisedLabel}
              </span>
            </li>
          )}
          {filtered.length === 0 && query.trim().length > 0 && (
            <li className="px-2 py-2 text-xs text-muted-foreground italic">
              No matches.
            </li>
          )}
          {filtered.map((e, i) => {
            const idx = i + firstEntryIdx;
            const isActive = idx === activeIdx;
            const isSelected = value === e.id;
            return (
              <li
                key={e.id}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(idx)}
                onClick={() => apply(e.id)}
                className={`flex items-center gap-2 px-2 py-1 text-xs cursor-pointer min-w-0 ${
                  isActive ? "bg-muted" : ""
                }`}
                title={e.fullPath}
              >
                <Check
                  className={`h-3 w-3 shrink-0 ${isSelected ? "opacity-100" : "opacity-0"}`}
                />
                <span
                  className="truncate min-w-0"
                  // 14px per depth step — visible without crowding the
                  // 288px popover at depth 2 (Grandchild → 28px lead).
                  style={{ paddingLeft: `${e.depth * 14}px` }}
                >
                  {e.leaf}
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
