"use client";

import useSWR from "swr";
import { useMemo, useState } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import { formatAUD, cn } from "@/lib/utils";
import type {
  CashflowReport as CashflowData,
  CashflowCategory,
} from "@/app/api/reports/cashflow/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Category × month heatmap.
 *
 * The previous design (GitHub-contributions-style 7×N day grid)
 * was weird: it answered "which day did you spend a lot?" — which
 * is rarely the question. The interesting question is "which
 * categories cost what each month?" — that's a 2-D matrix
 * problem and a heatmap is the natural shape for it.
 *
 * Rows = leaf categories (after optional root-filter), sorted by
 * total descending so the spendiest sit at the top. Columns =
 * months in the window. Cell colour intensity = spend amount /
 * row-max so seasonality reads at a glance ("Heating dark in
 * Jul-Aug, faint Nov-Feb"). Hovering a cell shows the actual
 * dollar figure; clicking navigates to the transactions list
 * filtered to that category + month.
 *
 * Backed by the existing `/api/reports/cashflow` payload — no
 * new endpoint needed; the cashflow report already returns the
 * byMonth × category structure. */
export function DailyHeatmapReport({
  from,
  to,
  accountIds,
  hideTransfers: _hideTransfers,
}: {
  from: string;
  to: string;
  accountIds: string[];
  hideTransfers: boolean;
}) {
  const [scope, setScope] = useState<"expenses" | "income">("expenses");
  const [rootCategoryId, setRootCategoryId] = useState<string | null>(null);

  const { data: allCategories = [] } = useSWR<
    {
      id: string;
      name: string;
      parentId: string | null;
      type: string;
      transferKind?: "none" | "internal" | "external" | null;
    }[]
  >("/api/categories", fetcher, { revalidateOnFocus: false });

  // Internal-transfer categories represent money moving between
  // the household's own accounts and aren't real spending; hiding
  // them keeps the heatmap honest. The cashflow API doesn't carry
  // transferKind itself, so we cross-reference via /api/categories.
  // External transfers (CC payoff to outside) stay — that's a real
  // outflow worth seeing in the heatmap.
  const internalTransferIds = useMemo(
    () =>
      new Set(
        allCategories
          .filter((c) => c.transferKind === "internal")
          .map((c) => c.id),
      ),
    [allCategories],
  );

  const params = new URLSearchParams({ from, to });
  if (accountIds.length > 0) params.set("accountIds", accountIds.join(","));
  const url = `/api/reports/cashflow?${params}`;
  const { data, isLoading } = useSWR<CashflowData>(url, fetcher);

  const months = data?.months ?? [];
  const cats: CashflowCategory[] = useMemo(() => {
    if (!data) return [];
    const baseList = scope === "expenses" ? data.expenses : data.income;
    const noInternal = baseList.filter(
      (c) => !internalTransferIds.has(c.id),
    );
    if (rootCategoryId == null) return noInternal;
    // Filter to the chosen root + descendants via the grandparent /
    // parent chain that already lives on each CashflowCategory row.
    return noInternal.filter(
      (c) =>
        c.id === rootCategoryId ||
        c.parentId === rootCategoryId ||
        c.grandparentId === rootCategoryId,
    );
  }, [data, scope, rootCategoryId, internalTransferIds]);

  // Roll up each category's monthly totals — non-leaf categories
  // with own activity AND descendants get a top-row that sums
  // both. Keep leaf-level granularity because that's what makes
  // a per-category heatmap interesting.
  const rows = useMemo(() => {
    if (cats.length === 0 || months.length === 0) return [];
    // Only leaf categories (no children present in this slice)
    // so the matrix doesn't double-count parent rows.
    const isLeaf = (c: CashflowCategory) => {
      // c is a leaf in this slice if no other cat in cats has
      // c.id as its parent.
      return !cats.some((other) => other.parentId === c.id);
    };
    const leaves = cats.filter(isLeaf);
    const out = leaves.map((c) => ({
      id: c.id,
      name: c.name,
      parentName: c.parentName,
      grandparentName: c.grandparentName,
      total: Math.abs(c.total),
      byMonth: months.map((m) => Math.abs(c.byMonth[m] ?? 0)),
    }));
    out.sort((a, b) => b.total - a.total);
    return out;
  }, [cats, months]);

  const cellMax = useMemo(() => {
    if (rows.length === 0) return 0;
    return Math.max(...rows.flatMap((r) => r.byMonth));
  }, [rows]);

  return (
    <Card>
      <CardHeader className="space-y-2 pb-3">
        <div className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            {scope === "expenses" ? "Expenses" : "Income"} ·
            category × month heatmap
          </CardTitle>
          <div
            role="tablist"
            className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
          >
            {(["expenses", "income"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={scope === s}
                onClick={() => setScope(s)}
                className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
                  scope === s
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
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
        ) : rows.length === 0 || months.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">
            No {scope} in the selected window.
          </p>
        ) : (
          <>
            <p className="text-[11px] text-muted-foreground mb-2">
              Each cell is one category × one month · colour intensity
              tracks the dollar amount (sqrt-scaled so a big month
              doesn&apos;t drown the dimmer ones) · click a cell to
              audit its transactions.
            </p>
            <div className="overflow-x-auto">
              <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
                <thead>
                  <tr>
                    <th className="text-left pr-3 sticky left-0 bg-card z-10" />
                    {months.map((m) => (
                      <th
                        key={m}
                        className="px-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wider whitespace-nowrap"
                      >
                        {format(parseISO(`${m}-01`), "MMM yy")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td
                        className="text-right pr-3 truncate max-w-[200px] sticky left-0 bg-card z-10"
                        title={
                          [r.grandparentName, r.parentName, r.name]
                            .filter(Boolean)
                            .join(" › ") +
                          ` — ${formatAUD(r.total)} total`
                        }
                      >
                        {r.name}
                      </td>
                      {r.byMonth.map((v, mi) => {
                        const intensity =
                          v > 0 && cellMax > 0
                            ? Math.min(1, Math.sqrt(v / cellMax))
                            : 0;
                        const tier = bucket(intensity);
                        return (
                          <td key={mi} className="p-0">
                            <HeatCell
                              v={v}
                              tier={tier}
                              accountIds={accountIds}
                              month={months[mi]}
                              categoryId={r.id}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map((t) => (
                <span
                  key={t}
                  className={cn(
                    "w-[18px] h-[14px] rounded-sm",
                    t === 0 && "bg-muted",
                    t === 1 && "bg-indigo-500/15",
                    t === 2 && "bg-indigo-500/30",
                    t === 3 && "bg-indigo-500/55",
                    t === 4 && "bg-indigo-500/80",
                  )}
                />
              ))}
              <span>More</span>
              <span className="ml-4">
                Peak cell: {formatAUD(cellMax)}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HeatCell({
  v,
  tier,
  accountIds,
  month,
  categoryId,
}: {
  v: number;
  tier: 0 | 1 | 2 | 3 | 4;
  accountIds: string[];
  month: string;
  categoryId: string;
}) {
  // Each cell spans the month — link into the transactions list
  // scoped to category + the YYYY-MM-01 → end-of-month window.
  const [year, mm] = month.split("-").map(Number);
  const lastDay = new Date(year, mm, 0).getDate();
  const href = `/transactions?categoryId=${categoryId}&includeChildren=true&from=${month}-01&to=${month}-${String(lastDay).padStart(2, "0")}${
    accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : ""
  }`;
  return (
    <Link
      href={href}
      title={`${formatAUD(v)}`}
      className={cn(
        "block w-[42px] h-[22px] rounded-sm transition-colors border border-transparent",
        tier === 0 && "bg-muted",
        tier === 1 && "bg-indigo-500/15",
        tier === 2 && "bg-indigo-500/30",
        tier === 3 && "bg-indigo-500/55",
        tier === 4 && "bg-indigo-500/80",
        "hover:border-indigo-400",
      )}
    >
      {v > 0 && (
        <span className="block text-[9px] text-center leading-[22px] tabular-nums opacity-80 mix-blend-difference text-white">
          {v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}
        </span>
      )}
    </Link>
  );
}

function bucket(x: number): 0 | 1 | 2 | 3 | 4 {
  if (x <= 0) return 0;
  if (x < 0.25) return 1;
  if (x < 0.5) return 2;
  if (x < 0.75) return 3;
  return 4;
}
