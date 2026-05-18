"use client";

import { mutate as globalMutate } from "swr";
import { TransactionCellDialog } from "./transaction-cell-dialog";

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
  const params = query ? buildQuery(query).toString() : "";
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
        // The accounts report doesn't bucket by category, but it does
        // report transfer totals that depend on whether a row is
        // categorised as a transfer-typed category. Revalidate the
        // accounts-cashflow cache so any cell totals affected by the
        // recat reshape immediately.
        globalMutate(
          (key) =>
            typeof key === "string" &&
            key.startsWith("/api/reports/accounts-cashflow"),
          undefined,
          { revalidate: true },
        );
      }}
    />
  );
}
