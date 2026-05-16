"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import { formatAUD } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BoxRow {
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  outliers: number[];
  n: number;
}
interface BoxplotResp {
  rows: BoxRow[];
}

/** Per-category amount-distribution boxplot.
 *
 * Recharts has no native boxplot. Render each category as a row
 * of inline SVG: min-to-max whisker line, Q1-to-Q3 filled box,
 * median tick, and outlier dots beyond. One SVG per row keeps
 * the layout simple (no shared coordinate space — each row scales
 * to its own min/max), but a shared X axis label at the bottom
 * shows the global $-scale so amounts are still legible across
 * categories.
 *
 * Sorting: API returns rows sorted by median descending. */
export function BoxplotReport({
  from,
  to,
  accountIds,
  hideTransfers,
}: {
  from: string;
  to: string;
  accountIds: string[];
  hideTransfers: boolean;
}) {
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [rootCategoryId, setRootCategoryId] = useState<string | null>(null);

  const { data: allCategories = [] } = useSWR<
    { id: string; name: string; parentId: string | null; type: string }[]
  >("/api/categories", fetcher, { revalidateOnFocus: false });

  const params = new URLSearchParams({ from, to, kind });
  if (accountIds.length > 0) params.set("accountIds", accountIds.join(","));
  if (hideTransfers) params.set("hideTransfers", "true");
  if (rootCategoryId) params.set("rootCategoryId", rootCategoryId);
  const url = `/api/reports/category-quartiles?${params}`;
  const { data, isLoading } = useSWR<BoxplotResp>(url, fetcher);

  const rows = data?.rows ?? [];
  const globalMax = useMemo(() => {
    if (rows.length === 0) return 0;
    return Math.max(
      ...rows.map((r) =>
        Math.max(r.max, ...(r.outliers.length > 0 ? r.outliers : [r.max])),
      ),
    );
  }, [rows]);

  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            Per-category amount distribution
          </CardTitle>
          <div
            role="tablist"
            className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
          >
            {(["expense", "income"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                  kind === k
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Filter to:</span>
          <CategoryDropdown
            value={rootCategoryId}
            onChange={setRootCategoryId}
            categories={allCategories}
            placeholder="All categories"
            uncategorisedLabel={null}
            triggerClassName="h-7 min-w-[180px]"
          />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            Loading…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No {kind} transactions in the selected window.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground mb-2">
              Box = Q1 → Q3 · vertical tick = median · whiskers = 1.5·IQR
              · dots = outliers beyond
            </p>
            <div className="space-y-1.5">
              {rows.map((r) => (
                <BoxplotRow key={r.categoryId} row={r} globalMax={globalMax} />
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BoxplotRow({ row, globalMax }: { row: BoxRow; globalMax: number }) {
  // Map values to a 0..1 fraction of the global max so all rows
  // align on the same x-axis (the visual rhythm matters; per-row
  // scaling would make a $5 coffee category look the same width as
  // a $5 000 rent category).
  const scale = globalMax > 0 ? (v: number) => (v / globalMax) * 100 : () => 0;
  return (
    <div className="grid grid-cols-[140px_1fr_80px] items-center gap-3 text-xs">
      <div className="truncate" title={row.categoryName}>
        <span
          className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
          style={{ backgroundColor: row.categoryColor }}
        />
        {row.categoryName}
      </div>
      <div
        className="relative h-5 bg-muted/40 rounded-sm"
        title={`min ${formatAUD(row.min)} · Q1 ${formatAUD(row.q1)} · median ${formatAUD(row.median)} · Q3 ${formatAUD(row.q3)} · max ${formatAUD(row.max)}`}
      >
        {/* Whiskers: thin horizontal line from min → max. */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-px bg-muted-foreground"
          style={{
            left: `${scale(row.min)}%`,
            width: `${Math.max(scale(row.max) - scale(row.min), 0.5)}%`,
          }}
        />
        {/* Box: Q1 → Q3 filled rectangle in the category colour. */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3 rounded-sm border"
          style={{
            left: `${scale(row.q1)}%`,
            width: `${Math.max(scale(row.q3) - scale(row.q1), 0.5)}%`,
            backgroundColor: `${row.categoryColor}55`,
            borderColor: row.categoryColor,
          }}
        />
        {/* Median tick: vertical line inside the box. */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-px h-3.5"
          style={{ left: `${scale(row.median)}%`, background: row.categoryColor }}
        />
        {/* Outliers: small dots beyond the whiskers. */}
        {row.outliers.map((o, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
            style={{
              left: `calc(${scale(o)}% - 3px)`,
              backgroundColor: row.categoryColor,
              opacity: 0.65,
            }}
            title={`Outlier · ${formatAUD(o)}`}
          />
        ))}
      </div>
      <div className="text-right tabular-nums text-muted-foreground">
        {row.n} txn{row.n === 1 ? "" : "s"}
      </div>
    </div>
  );
}
