import type { ReactNode } from "react";
import { NetWorthCard } from "@/components/dashboard/net-worth-card";
import { Income30dCard } from "@/components/dashboard/income-30d-card";
import { Expenses30dCard } from "@/components/dashboard/expenses-30d-card";
import { StocksSummaryCard } from "@/components/dashboard/stocks-summary-card";
import { OptionsSummaryCard } from "@/components/dashboard/options-summary-card";
import { PaperTradeSummaryCard } from "@/components/dashboard/paper-trade-summary-card";
import { SuperSummaryCard } from "@/components/dashboard/super-summary-card";
import { NetWorthTrendCard } from "@/components/dashboard/net-worth-trend-card";
import { BudgetProgressCard } from "@/components/dashboard/budget-progress-card";
import { UpcomingSchedulesCard } from "@/components/dashboard/upcoming-schedules-card";
import { AccountsCard } from "@/components/dashboard/accounts-card";

/** A single dashboard widget — a discrete content block the operator
 * can drag onto the grid, rearrange, resize within sane limits, or
 * remove entirely. The `render` is a thunk so the registry stays
 * lightweight and the actual card is only mounted when placed. */
export interface WidgetSpec {
  id: string;
  title: string;
  /** Initial grid size in 12-col units. Caller can resize after
   * placing. Width clamps at 12 (full row); height has no hard cap
   * but practically stays at 1-6 rows tall. */
  defaultLayout: { w: number; h: number };
  /** Minimum size — keeps the widget from being shrunk into
   * unreadability. */
  minSize?: { w: number; h: number };
  render: () => ReactNode;
}

/** Every widget known to the dashboard. Adding a new widget = one
 * new entry here + an opt-in default-layout slot in
 * `DEFAULT_DASHBOARD_LAYOUT` below (or leave it out so it surfaces
 * in the drawer as something the operator opts into). */
export const WIDGETS: WidgetSpec[] = [
  {
    id: "net-worth",
    title: "Net Worth",
    defaultLayout: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    render: () => <NetWorthCard />,
  },
  {
    id: "income-30d",
    title: "Income (30 days)",
    defaultLayout: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    render: () => <Income30dCard />,
  },
  {
    id: "expenses-30d",
    title: "Expenses (30 days)",
    defaultLayout: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    render: () => <Expenses30dCard />,
  },
  {
    id: "stocks-summary",
    title: "Stocks",
    defaultLayout: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    render: () => <StocksSummaryCard />,
  },
  {
    id: "options-summary",
    title: "Options",
    defaultLayout: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    render: () => <OptionsSummaryCard />,
  },
  {
    id: "paper-trade-summary",
    title: "Paper trades",
    defaultLayout: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    render: () => <PaperTradeSummaryCard />,
  },
  {
    id: "super-summary",
    title: "Superannuation",
    defaultLayout: { w: 2, h: 2 },
    minSize: { w: 2, h: 2 },
    render: () => <SuperSummaryCard />,
  },
  {
    id: "net-worth-trend",
    title: "Net Worth Trend",
    defaultLayout: { w: 3, h: 3 },
    minSize: { w: 2, h: 3 },
    render: () => <NetWorthTrendCard />,
  },
  {
    id: "budget-progress",
    title: "Budget Progress",
    defaultLayout: { w: 3, h: 4 },
    minSize: { w: 2, h: 3 },
    render: () => <BudgetProgressCard />,
  },
  {
    id: "upcoming-schedules",
    title: "Upcoming",
    defaultLayout: { w: 6, h: 4 },
    minSize: { w: 3, h: 3 },
    render: () => <UpcomingSchedulesCard />,
  },
  {
    id: "accounts",
    title: "Accounts",
    defaultLayout: { w: 12, h: 6 },
    minSize: { w: 4, h: 4 },
    render: () => <AccountsCard />,
  },
];

export const WIDGETS_BY_ID = new Map(WIDGETS.map((w) => [w.id, w]));

/** Layout the dashboard renders on an account that has never edited
 * the grid. Matches the pre-widget arrangement so existing operators
 * see no UX change until they open the editor.
 *
 * Grid is 12 columns wide. y is auto-resolved by react-grid-layout
 * when omitted, so we mostly just supply x + the natural row order. */
export const DEFAULT_DASHBOARD_LAYOUT: Array<{
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}> = [
  // Row 1: five summary cards
  { widgetId: "net-worth", x: 0, y: 0, w: 2, h: 2 },
  { widgetId: "income-30d", x: 2, y: 0, w: 2, h: 2 },
  { widgetId: "expenses-30d", x: 4, y: 0, w: 2, h: 2 },
  { widgetId: "stocks-summary", x: 6, y: 0, w: 2, h: 2 },
  { widgetId: "super-summary", x: 8, y: 0, w: 2, h: 2 },
  // Row 2: trend + budget
  { widgetId: "net-worth-trend", x: 0, y: 2, w: 6, h: 3 },
  { widgetId: "budget-progress", x: 6, y: 2, w: 6, h: 3 },
  // Row 3: accounts
  { widgetId: "accounts", x: 0, y: 5, w: 12, h: 6 },
  // Row 4: upcoming
  { widgetId: "upcoming-schedules", x: 0, y: 11, w: 12, h: 4 },
];
