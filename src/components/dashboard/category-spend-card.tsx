"use client";

import { useSwrJson } from "@/hooks/use-swr-json";
import Link from "next/link";
import { Tag } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import { cn, formatAUD, amountClass } from "@/lib/utils";
import { TREND_UP, TREND_DOWN } from "@/lib/colours";


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
  series?: { date: string; value: number }[];
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

  const { data: categoriesData } = useSwrJson<CategoryOption[]>(
    "/api/categories",
    { revalidateOnFocus: false },
  );
  const categories: CategoryOption[] = Array.isArray(categoriesData)
    ? categoriesData
    : [];

  const { data: spendData } = useSwrJson<SpendResp>(
    categoryId
      ? `/api/dashboard/category-spend?categoryId=${categoryId}&days=30&includeChildren=true`
      : null,
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
          <div className="flex flex-col flex-1 min-h-0">
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
            {/* Daily bars over the same window. Bar height uses the
                absolute value so an expense category (negative) and
                an income category (positive) both render upward. The
                fill tone follows the category's sign so the chart's
                colour matches the headline. */}
            {spendData.series && spendData.series.length > 0 && (
              <div className="flex-1 min-h-0 -mx-1 mt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={spendData.series.map((d) => ({
                      date: d.date,
                      value: Math.abs(d.value),
                    }))}
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                  >
                    <Bar
                      dataKey="value"
                      fill={spendData.total >= 0 ? TREND_UP : TREND_DOWN}
                      radius={[1, 1, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
