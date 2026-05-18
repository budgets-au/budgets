"use client";

import useSWR, { mutate as globalMutate } from "swr";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAUD } from "@/lib/utils";
import { NotesCell } from "@/components/transactions/notes-cell";
import { CategoryPicker } from "@/components/transactions/category-picker";
import type { CategoryLike } from "@/components/categories/category-dropdown";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface CashflowCellQuery {
  /** Category UUID, or "__uncat__" sentinel for uncategorised drill-throughs. */
  categoryId: string;
  /** When true the API recurses descendants — used for parent / grandparent
   * rows whose displayed total is the aggregate across the subtree. */
  includeChildren?: boolean;
  from: string;
  to: string;
  /** Short label rendered in the dialog title — e.g. "Mar '24" or "Apr '24 – Sep '24". */
  rangeLabel: string;
  displayName: string;
  /** Limits to inflows or outflows. Used for the synthetic
   * "Uncategorised income/expenses" rows so the popup only shows the
   * matching half. */
  direction?: "in" | "out";
}

interface Txn {
  id: string;
  date: string;
  payee: string | null;
  notes: string | null;
  amount: string;
  accountName: string | null;
  categoryId: string | null;
  categoryName: string | null;
}

function buildQuery(
  q: CashflowCellQuery,
  accountIds: string[],
  hideTransfers: boolean,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("categoryId", q.categoryId);
  if (q.includeChildren) params.set("includeChildren", "true");
  params.set("from", q.from);
  params.set("to", q.to);
  if (q.direction) params.set("direction", q.direction);
  if (hideTransfers) params.set("hideTransfers", "true");
  if (accountIds.length > 0) params.set("accountIds", accountIds.join(","));
  return params;
}

export function CashflowCellDialog({
  query,
  accountIds,
  hideTransfers,
  onClose,
}: {
  query: CashflowCellQuery | null;
  accountIds: string[];
  hideTransfers: boolean;
  onClose: () => void;
}) {
  const open = query !== null;

  const apiUrl = query
    ? `/api/transactions?${buildQuery(query, accountIds, hideTransfers).toString()}&limit=500&sort=date&order=desc`
    : null;
  const { data: txns = [], isLoading } = useSWR<Txn[]>(apiUrl, fetcher);
  const { data: categories = [] } = useSWR<CategoryLike[]>(
    open ? "/api/categories" : null,
    fetcher,
  );

  function handleCategoryChanged() {
    if (apiUrl) globalMutate(apiUrl);
    // The cashflow report's totals partition transactions by
    // category, so a recategorise here must refresh the parent
    // report's SWR cache too — otherwise the cell the popup is
    // drilled into stays out of sync until a hard reload.
    globalMutate(
      (key) => typeof key === "string" && key.startsWith("/api/reports/cashflow"),
      undefined,
      { revalidate: true },
    );
  }

  const fullPageHref = query
    ? `/transactions?${buildQuery(query, accountIds, hideTransfers).toString()}`
    : "#";

  const total = txns.reduce((s, t) => s + parseFloat(t.amount), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[50vw] flex flex-col max-h-[80vh] p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle>
            {query?.displayName}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · {query?.rangeLabel}
            </span>
          </DialogTitle>
          {!isLoading && txns.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {txns.length} {txns.length === 1 ? "transaction" : "transactions"}
              <span className="mx-1.5">·</span>
              <span className={total < 0 ? "text-red-500" : "text-emerald-600"}>
                {formatAUD(total)}
              </span>
            </p>
          )}
        </DialogHeader>
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Loading…
            </p>
          ) : txns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No transactions.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">Date</th>
                  <th className="text-left px-3 py-2 font-medium">Payee</th>
                  <th className="text-left px-3 py-2 font-medium">Account</th>
                  <th className="text-left px-3 py-2 font-medium">Category</th>
                  <th className="text-right px-3 py-2 font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {txns.map((t) => {
                  const amt = parseFloat(t.amount);
                  return (
                    <tr key={t.id} className="hover:bg-muted/40">
                      <td className="px-3 py-1.5 whitespace-nowrap tabular-nums">
                        {format(parseISO(t.date), "d MMM")}
                      </td>
                      <td className="px-3 py-1.5 max-w-[320px]">
                        <div className="truncate">{t.payee ?? "—"}</div>
                        <NotesCell
                          transactionId={t.id}
                          notes={t.notes}
                          onSaved={() => {
                            if (apiUrl) globalMutate(apiUrl);
                          }}
                        />
                      </td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        {t.accountName ?? "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <CategoryPicker
                          transactionId={t.id}
                          categoryId={t.categoryId}
                          categoryName={t.categoryName}
                          categories={categories}
                          onChanged={handleCategoryChanged}
                        />
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${
                          amt < 0 ? "text-red-500" : "text-emerald-600"
                        }`}
                      >
                        {formatAUD(t.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t px-4 py-2 flex justify-end bg-muted/30">
          <Link
            href={fullPageHref}
            onClick={onClose}
            className="text-xs text-indigo-600 hover:underline"
          >
            Open in transactions →
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
