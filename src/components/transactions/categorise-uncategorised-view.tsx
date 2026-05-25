"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import { Button } from "@/components/ui/button";
import { useSwrJson } from "@/hooks/use-swr-json";
import { formatAUD, amountClass, cn } from "@/lib/utils";
import { Check, Loader2, RefreshCw } from "lucide-react";
import type { UncategorisedRow } from "@/app/api/transactions/uncategorised-categorise/route";

interface CategoryLike {
  id: string;
  name: string;
  parentId: string | null;
  type: "income" | "expense";
}

/** Bulk-categorise long-tail uncategorised transactions using the
 *  same suggester (`suggestCategoryByHistory`) the CSV import flow
 *  drives the post-parse pickers with. Per-row immediate save:
 *  picking a category PATCHes the transaction right away and the
 *  row gets marked saved (struck-through + dimmed). No commit step;
 *  no "apply all". The user blows through the queue at one click
 *  per row.
 *
 *  Rows sort by suggester score DESC, so the easy wins come first
 *  and ambiguous tail (low-score or no suggestion) sinks to the
 *  bottom. */
export function CategoriseUncategorisedView({
  categories,
}: {
  categories: CategoryLike[];
}) {
  const { data, isLoading, error, mutate } = useSwrJson<UncategorisedRow[]>(
    "/api/transactions/uncategorised-categorise",
  );

  // Track per-row in-flight + saved state. Saved rows stay visible
  // (struck-through, dimmed) so the user has visual continuity —
  // no jumpy reflow as they pick row after row.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  const rows = data ?? [];
  const remaining = rows.filter((r) => !savedIds.has(r.id)).length;

  // Stable category list per type so each row's picker filter is
  // memo'd, not recomputed on every render.
  const expenseCats = useMemo(
    () => categories.filter((c) => c.type === "expense"),
    [categories],
  );
  const incomeCats = useMemo(
    () => categories.filter((c) => c.type === "income"),
    [categories],
  );

  async function applyCategory(row: UncategorisedRow, categoryId: string | null) {
    if (!categoryId) return; // null = clearing — not what we want here
    setSavingId(row.id);
    try {
      const res = await fetch(`/api/transactions/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        toast.error(`Save failed: ${res.status} ${body.slice(0, 80)}`);
        return;
      }
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.add(row.id);
        return next;
      });
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSavingId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground p-6">
        Loading uncategorised transactions…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600 p-6">
        Failed to load: {String(error)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        Nothing to categorise — every transaction already has a category.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      {/* Header strip — counts + refresh */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-medium text-sm">
          {remaining > 0
            ? `${remaining} uncategorised · ${savedIds.size} saved`
            : `All caught up — ${savedIds.size} saved this session`}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSavedIds(new Set());
            void mutate();
          }}
          title="Reload + re-score from the latest DB state"
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Date</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Account</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Payee</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Category</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Confidence</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => {
              const saved = savedIds.has(row.id);
              const saving = savingId === row.id;
              // Expense vs income filter for the dropdown — saves the
              // user from picking an income category on a -$50 spend.
              const amt = parseFloat(row.amount);
              const typeFilter = amt < 0 ? "expense" : "income";
              const filteredCats = typeFilter === "expense" ? expenseCats : incomeCats;
              return (
                <tr
                  key={row.id}
                  className={cn(
                    saved && "opacity-40 line-through",
                    !saved && "hover:bg-muted/30",
                  )}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {row.date}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {row.accountName}
                  </td>
                  <td className="px-3 py-2 max-w-[280px] truncate" title={row.payee ?? undefined}>
                    {row.payee ?? <span className="text-muted-foreground italic">(no payee)</span>}
                  </td>
                  <td className={cn("px-3 py-2 text-right whitespace-nowrap font-medium", amountClass(row.amount))}>
                    {formatAUD(row.amount)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CategoryDropdown
                        value={row.suggestedCategoryId}
                        onChange={(catId) => {
                          if (!saved && catId) void applyCategory(row, catId);
                        }}
                        categories={filteredCats}
                        typeFilter={typeFilter}
                        disabled={saved || saving}
                        placeholder="Pick a category…"
                      />
                      {saving && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      )}
                      {saved && <Check className="h-3.5 w-3.5 text-green-600" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                    {row.suggestedScore != null
                      ? `${Math.round(row.suggestedScore * 100)}% · ${row.suggestedSupport ?? 0} backed`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
