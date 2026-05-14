"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { buildCategoryMeta } from "@/lib/category-path";
import { Switch } from "@/components/ui/switch";
import {
  SearchableCombobox,
  type ComboboxItem,
} from "@/components/ui/searchable-combobox";
import { SavedFilters } from "@/components/transactions/saved-filters";

interface Props {
  accounts: { id: string; name: string }[];
  categories: { id: string; name: string; parentId: string | null }[];
  current: {
    accountId?: string;
    accountIds?: string;
    categoryId?: string;
    from?: string;
    to?: string;
    search?: string;
    includeChildren?: boolean;
    transfersFilter?: "only" | "none" | null;
    scheduledFilter?: "only" | "none" | null;
    direction?: "in" | "out" | null;
  };
}

export function TransactionFilters({ accounts, categories, current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [accountId, setAccountId] = useState(current.accountId ?? "");
  const [categoryId, setCategoryId] = useState(current.categoryId ?? "");
  const [includeChildren, setIncludeChildren] = useState(current.includeChildren ?? false);
  const [transfersFilter, setTransfersFilter] = useState<"all" | "only" | "none">(
    current.transfersFilter === "only" ? "only" : current.transfersFilter === "none" ? "none" : "all",
  );
  const [scheduledFilter, setScheduledFilter] = useState<"all" | "only" | "none">(
    current.scheduledFilter === "only" ? "only" : current.scheduledFilter === "none" ? "none" : "all",
  );
  const [search, setSearch] = useState(current.search ?? "");
  const [fromDate, setFromDate] = useState(current.from ?? "");
  const [toDate, setToDate] = useState(current.to ?? "");

  /** Patch URL search params without remounting the page. router.replace
   * does a soft client navigation, which keeps the input element focused
   * (a form submit would do a hard nav and drop focus mid-typing). */
  function patchParams(updates: Record<string, string | null>) {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v == null || v === "") p.delete(k);
      else p.set(k, v);
    }
    // Filter changes always reset paging.
    p.delete("page");
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Search debounce — give a slow typer enough breathing room. Enter
  // applies immediately for impatient users.
  const isFirstSearch = useRef(true);
  useEffect(() => {
    if (isFirstSearch.current) {
      isFirstSearch.current = false;
      return;
    }
    if (search === (current.search ?? "")) return;
    const t = setTimeout(() => patchParams({ search }), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { meta: catMeta } = buildCategoryMeta(categories);

  // Combobox option lists.
  const accountItems: ComboboxItem[] = accounts
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, label: a.name }));
  const categoryItems: ComboboxItem[] = categories
    .map((c) => {
      const m = catMeta.get(c.id);
      const path = m?.path ?? [c.name];
      return {
        id: c.id,
        label: path[path.length - 1],
        ancestors: path.slice(0, -1),
      };
    })
    .sort((a, b) =>
      [...(a.ancestors ?? []), a.label]
        .join(" / ")
        .localeCompare([...(b.ancestors ?? []), b.label].join(" / ")),
    );

  return (
    <div className="flex flex-wrap gap-3 w-full">
      <SearchableCombobox
        value={accountId}
        onChange={(next) => {
          setAccountId(next);
          patchParams({ accountId: next });
        }}
        items={accountItems}
        pinnedItems={[{ id: "", label: "All Accounts", italic: true }]}
        searchPlaceholder="Search accounts…"
        emptyTriggerLabel="All Accounts"
      />

      <SearchableCombobox
        value={categoryId}
        onChange={(next) => {
          setCategoryId(next);
          if (!next) setIncludeChildren(false);
          patchParams({
            categoryId: next,
            includeChildren: next ? (includeChildren ? "true" : null) : null,
          });
        }}
        items={categoryItems}
        pinnedItems={[
          { id: "", label: "All Categories", italic: true },
          { id: "__uncat__", label: "Uncategorised", italic: true },
        ]}
        searchPlaceholder="Search categories…"
        emptyTriggerLabel="All Categories"
        triggerClassName="text-sm border rounded-md px-3 py-2 bg-background h-auto min-w-[160px] w-auto inline-flex items-center justify-between gap-2"
      />

      {categoryId && categoryId !== "__uncat__" && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 self-center cursor-pointer">
          <Switch
            checked={includeChildren}
            onCheckedChange={(checked) => {
              setIncludeChildren(checked);
              patchParams({ includeChildren: checked ? "true" : null });
            }}
            aria-label="Include child categories"
          />
          Include children
        </label>
      )}

      <input
        type="date" min="1900-01-01" max="2099-12-31"
        value={fromDate}
        onChange={(e) => {
          const v = e.target.value;
          setFromDate(v);
          // Empty (cleared) or a fully-typed yyyy-mm-dd → apply.
          if (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)) {
            patchParams({ from: v || null });
          }
        }}
        className="text-sm border rounded-md px-3 py-2 bg-background"
      />
      <input
        type="date" min="1900-01-01" max="2099-12-31"
        value={toDate}
        onChange={(e) => {
          const v = e.target.value;
          setToDate(v);
          if (v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v)) {
            patchParams({ to: v || null });
          }
        }}
        className="text-sm border rounded-md px-3 py-2 bg-background"
      />
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            patchParams({ search });
          }
        }}
        placeholder="Search payee…"
        className="text-sm border rounded-md px-3 py-2 bg-background"
      />

      <a
        href="/transactions"
        className="text-sm text-muted-foreground self-center hover:underline"
      >
        Clear
      </a>

      <div
        role="radiogroup"
        aria-label="Scheduled filter"
        className="flex rounded-md border overflow-hidden text-xs shrink-0 self-center ml-auto"
      >
        {([
          { value: "all", label: "All" },
          { value: "only", label: "Scheduled" },
          { value: "none", label: "Unscheduled" },
        ] as const).map((opt) => {
          const active = scheduledFilter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setScheduledFilter(opt.value);
                patchParams({
                  scheduledFilter: opt.value === "all" ? null : opt.value,
                });
              }}
              className={`px-2.5 py-1 transition-colors ${
                active
                  ? "bg-indigo-600 text-white font-medium"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div
        role="radiogroup"
        aria-label="Transfer filter"
        className="flex rounded-md border overflow-hidden text-xs shrink-0 self-center"
      >
        {([
          { value: "all", label: "All" },
          { value: "only", label: "Transfers" },
          { value: "none", label: "No transfers" },
        ] as const).map((opt) => {
          const active = transfersFilter === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                setTransfersFilter(opt.value);
                patchParams({
                  transfersFilter: opt.value === "all" ? null : opt.value,
                });
              }}
              className={`px-2.5 py-1 transition-colors ${
                active
                  ? "bg-indigo-600 text-white font-medium"
                  : "bg-background text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Sit Saved Filters to the right of the radio toggles when
          there's room (it wraps below otherwise). Anchored here
          rather than as a sibling in the parent flex wrap so it
          rides the same line as the filter affordances. */}
      <div className="self-center shrink-0">
        <SavedFilters />
      </div>
    </div>
  );
}
