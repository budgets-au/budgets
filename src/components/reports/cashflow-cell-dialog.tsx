"use client";

import { mutate as globalMutate } from "swr";
import { TransactionCellDialog } from "./transaction-cell-dialog";

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
  const params = query ? buildQuery(query, accountIds, hideTransfers).toString() : "";
  const apiUrl = query
    ? `/api/transactions?${params}&limit=500&sort=date&order=desc`
    : null;
  const fullPageHref = query ? `/transactions?${params}` : "#";

  return (
    <TransactionCellDialog
      open={open}
      onClose={onClose}
      apiUrl={apiUrl}
      fullPageHref={fullPageHref}
      title={query?.displayName ?? ""}
      subtitle={query?.rangeLabel}
      onCategoryChanged={() => {
        // The cashflow report's totals partition transactions by
        // category, so a recategorise from the popup must refresh
        // the parent report's SWR cache too — otherwise the cell the
        // popup is drilled into stays out of sync until a hard reload.
        globalMutate(
          (key) => typeof key === "string" && key.startsWith("/api/reports/cashflow"),
          undefined,
          { revalidate: true },
        );
      }}
    />
  );
}
