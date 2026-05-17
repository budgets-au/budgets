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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Mode mirrors the parent report's row type — drives the direction +
 *  transfersFilter + transferPairAccountId derivation used on the API
 *  side. Same enum as accounts-cashflow-report.tsx so the parent can
 *  hand the popup the exact cell context. */
export type AccountsCellMode =
  | "credit"
  | "debit"
  | "net"
  | "transferIn"
  | "transferOut";

export interface AccountsCellQuery {
  mode: AccountsCellMode;
  /** ISO date range for the API. Either a single month
   *  (yyyy-MM-01 → end of month) or the full report window. */
  from: string;
  to: string;
  /** Short label rendered in the dialog title — "Mar '24" or
   *  "Jul 2025 – May 2026". */
  rangeLabel: string;
  /** Short label for the account + metric — "Checking · Credits" or
   *  "All accounts · Transfer in from Savings". */
  displayName: string;
  /** When present, narrow to a single account (the per-account-row
   *  drill-throughs). Omit for the footer's "All accounts" rows. */
  accountId?: string;
  /** Counterparty constraint for the per-counterparty transfer
   *  rows. UUID drills to the OTHER leg's account; `null` is the
   *  legacy "External" bucket (pre-backfill data only); `undefined`
   *  for non-per-counterparty rows. */
  counterpartyId?: string | null;
}

interface Txn {
  id: string;
  date: string;
  payee: string | null;
  notes: string | null;
  amount: string;
  accountName: string | null;
  categoryName: string | null;
}

/** Build the /api/transactions URL params from the cell context.
 *  Mirrors the original `buildCellHref()` mapping in accounts-cashflow-
 *  report.tsx so the popup's underlying list matches what the parent
 *  cell summed. */
function buildQuery(q: AccountsCellQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", q.from);
  params.set("to", q.to);
  if (q.accountId) params.set("accountIds", q.accountId);
  if (q.mode === "credit") params.set("direction", "in");
  else if (q.mode === "debit") params.set("direction", "out");
  else if (q.mode === "transferIn") {
    params.set("direction", "in");
    params.set("transfersFilter", "only");
  } else if (q.mode === "transferOut") {
    params.set("direction", "out");
    params.set("transfersFilter", "only");
  }
  if (q.counterpartyId === null) {
    params.set("transferPairAccountId", "external");
  } else if (q.counterpartyId !== undefined) {
    params.set("transferPairAccountId", q.counterpartyId);
  }
  return params;
}

export function AccountsCellDialog({
  query,
  onClose,
}: {
  query: AccountsCellQuery | null;
  onClose: () => void;
}) {
  const open = query !== null;

  const apiUrl = query
    ? `/api/transactions?${buildQuery(query).toString()}&limit=500&sort=date&order=desc`
    : null;
  const { data: txns = [], isLoading } = useSWR<Txn[]>(apiUrl, fetcher);

  const fullPageHref = query
    ? `/transactions?${buildQuery(query).toString()}`
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
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                        {t.categoryName ?? "—"}
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
