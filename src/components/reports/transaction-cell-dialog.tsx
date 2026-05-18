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

export interface TransactionCellDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fully-built `/api/transactions?...` URL the dialog should fetch.
   *  Null short-circuits SWR (used while the popup is closed). */
  apiUrl: string | null;
  /** Destination of the "Open in transactions →" footer link. */
  fullPageHref: string;
  /** Header title — the cell's display name (e.g. "Food / Groceries"
   *  or "Checking · Credits"). */
  title: string;
  /** Optional muted right-of-title fragment, e.g. "Mar '24". */
  subtitle?: string;
  /** Caller hook fired AFTER a row's category PATCH succeeds, in
   *  addition to the built-in revalidation of `apiUrl`. Use it to
   *  invalidate any report-level SWR caches the parent owns so its
   *  totals reshape. */
  onCategoryChanged?: () => void;
}

/** Shared drill-through popup for report cells. Renders a date /
 *  payee / account / inline-category-picker / amount table over a
 *  caller-supplied /api/transactions URL. The cashflow and accounts
 *  reports both build their own query params and hand the URL in;
 *  this component owns the SWR fetch, the inline category recat
 *  affordance, and the report-cache invalidation that follows it. */
export function TransactionCellDialog({
  open,
  onClose,
  apiUrl,
  fullPageHref,
  title,
  subtitle,
  onCategoryChanged,
}: TransactionCellDialogProps) {
  const { data: txns = [], isLoading } = useSWR<Txn[]>(
    open ? apiUrl : null,
    fetcher,
  );
  const { data: categories = [] } = useSWR<CategoryLike[]>(
    open ? "/api/categories" : null,
    fetcher,
  );

  function handleCategoryChanged() {
    if (apiUrl) globalMutate(apiUrl);
    onCategoryChanged?.();
  }

  const total = txns.reduce((s, t) => s + parseFloat(t.amount), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-[50vw] flex flex-col max-h-[80vh] p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle>
            {title}
            {subtitle && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                · {subtitle}
              </span>
            )}
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
