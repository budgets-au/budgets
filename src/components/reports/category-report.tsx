"use client";

import { CashflowReport } from "./cashflow-report";

/** The Category tab is the Cashflow report with the per-month
 *  axis turned off — one row per category, with the same
 *  toolbar, hierarchy, rollup, collapse, and Plan/Diff
 *  behaviour. Keeping it as a one-line wrapper means every
 *  feature added to Cashflow lights up on Category automatically;
 *  no second renderer to keep in sync. */
export function CategoryReport(props: {
  from: string;
  to: string;
  accountIds: string[];
}) {
  return <CashflowReport {...props} monthAxis={false} />;
}
