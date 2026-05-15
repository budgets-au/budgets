"use client";

import useSWR from "swr";
import Link from "next/link";
import { Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import { cn, formatAUD, amountClass } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CategoryOption {
  id: string;
  name: string;
  parentId: string | null;
  type?: string;
}

interface SpendResp {
  total: number;
  count: number;
  name: string | null;
}

/** Dashboard widget that pins a single user-picked category and
 * shows its total spend over the past 30 days. multiInstance so a
 * dashboard can hold several (Groceries · Petrol · Bills) side by
 * side. Drills into `/transactions?categoryId=…&includeChildren=true`
 * so the operator can audit the rows that contributed.
 *
 * Note: the picker carries `widget-cancel-drag` so RGL doesn't
 * swallow clicks that open it. */
export function CategorySpendCard({
  config,
  editMode,
  onConfigChange,
}: {
  config?: Record<string, unknown>;
  editMode: boolean;
  onConfigChange?: (next: Record<string, unknown>) => void;
}) {
  const categoryId =
    typeof config?.categoryId === "string" ? config.categoryId : null;

  const { data: categoriesData } = useSWR<CategoryOption[]>(
    "/api/categories",
    fetcher,
    { revalidateOnFocus: false },
  );
  const categories: CategoryOption[] = Array.isArray(categoriesData)
    ? categoriesData
    : [];

  const { data: spendData } = useSWR<SpendResp>(
    categoryId
      ? `/api/dashboard/category-spend?categoryId=${categoryId}&days=30&includeChildren=true`
      : null,
    fetcher,
    { revalidateOnFocus: false },
  );

  const selectedName =
    spendData?.name ??
    categories.find((c) => c.id === categoryId)?.name ??
    null;

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5" />
          {categoryId && selectedName ? (
            <Link
              href={`/transactions?categoryId=${categoryId}&includeChildren=true`}
              className="hover:text-foreground transition-colors truncate"
              title={selectedName}
            >
              {selectedName}
            </Link>
          ) : (
            "Category"
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        {editMode && (
          <div
            className="widget-cancel-drag mb-2"
            // Wrap CategoryDropdown in a no-drag container so the
            // popover click + keyboard nav aren't intercepted by
            // RGL's drag handler.
          >
            <CategoryDropdown
              value={categoryId}
              onChange={(v) => onConfigChange?.({ categoryId: v ?? null })}
              categories={categories}
              placeholder="Pick a category…"
              triggerClassName="w-full"
              uncategorisedLabel={null}
            />
          </div>
        )}
        {!categoryId ? (
          <p className="text-xs text-muted-foreground">
            {editMode
              ? "Pick a category from the dropdown."
              : "No category configured. Enter edit mode to pick one."}
          </p>
        ) : !spendData ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col">
            {/* Headline = magnitude of summed amounts in the window.
              An expense category sums to a negative number, an
              income category to positive; amountClass picks the
              tint, the headline shows the absolute value so the
              widget reads at a glance as "this is how much went
              through this bucket". */}
            <p
              className={cn(
                "text-2xl font-bold leading-tight",
                amountClass(spendData.total),
              )}
            >
              {formatAUD(Math.abs(spendData.total))}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {spendData.count.toLocaleString()} txn
              {spendData.count === 1 ? "" : "s"} · last 30 days
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
