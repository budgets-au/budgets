"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSwrJson } from "@/hooks/use-swr-json";
import { addMonths, addWeeks, addYears, format, parseISO, subMonths } from "date-fns";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { Trash2, ChevronUp, ChevronDown, GitBranch } from "lucide-react";
import { ScheduledNotesPopover } from "@/components/scheduled/scheduled-notes-popover";
import { mutate as swrMutate } from "swr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatAUD, amountClass, formatDate, diffDaysISO, cn } from "@/lib/utils";
import { matchSchedule } from "@/lib/scheduled-match";
import { expandRecurrence } from "@/lib/recurrence";
import { FORECAST_HORIZON } from "@/lib/forecast";
import { colourForFrequency, colourForLineageRank, colourForBudgetPeriod, dimColour, freqLabel } from "@/lib/schedule-colours";
import { invalidateCashflow } from "@/lib/invalidate-cashflow";
import { TREND_DOWN } from "@/lib/colours";
import { currentBudgetPeriod, pastBudgetPeriods } from "@/lib/budget-period";
import { ScheduledEditForm, type ScheduledFormRow } from "@/components/scheduled/scheduled-edit-form";
import { NewScheduledDialog } from "@/components/scheduled/new-scheduled-dialog";
import { ScheduledForecastRows } from "@/components/scheduled/scheduled-forecast-rows";
import { ScheduledOccurrencesChart, type ChartSegment } from "@/components/scheduled/scheduled-occurrences-chart";
import {
  FABULOUS_THEME_ID,
  resolveSchedulePalette,
} from "@/lib/chart-palettes";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccountFilter } from "@/hooks/use-account-filter";
import type { ScheduledTransaction, Category } from "@/db/schema";

const MATCH_TOLERANCE_DAYS = 5;
// Range-mode schedules (utilities, energy bills, etc.) bill on irregular
// cycles, so the date drift tolerance is loosened when amountMin is set.
const MATCH_TOLERANCE_DAYS_RANGE = 14;
const MATCH_WINDOW_OPTIONS: { label: string; months: number }[] = [
  { label: "1m", months: 1 },
  { label: "3m", months: 3 },
  { label: "6m", months: 6 },
  { label: "12m", months: 12 },
];
const DEFAULT_MATCH_WINDOW_MONTHS = 6;
const MISSED_ROW_COLOUR = TREND_DOWN; // red-500, mirrors the chart's missed-bar fill

interface ScheduledRow {
  id: string;
  kind: string;
  payee: string | null;
  description: string | null;
  notes: string | null;
  amount: string;
  amountMin: string | null;
  type: string;
  categoryId: string | null;
  accountId: string | null;
  transferToAccountId: string | null;
  frequency: string;
  interval: number;
  startDate: string;
  endDate: string | null;
  dayOfMonth: number | null;
  isActive: boolean;
  lineageId: string;
  accountName: string | null;
  accountColor: string | null;
  categoryName: string | null;
}

interface AccountLite {
  id: string;
  name: string;
  color: string;
  /** checking | savings | credit | loan | cash. Used to distinguish
   * asset-to-asset transfers (internal, net to zero in totals) from
   * asset-to-liability transfers (real cashflow, e.g. paying off a loan). */
  type: string;
  /** Per-account opt-out: when true, any transfer touching this account
   * counts as real cashflow regardless of types (savings buckets etc.). */
  isExternal: boolean;
}

interface TxRow {
  id: string;
  date: string;
  amount: string;
  payee: string | null;
  description: string | null;
  accountId: string;
  accountName: string | null;
  accountColor: string | null;
  categoryId: string | null;
  /** Set when this row is one half of a matched transfer pair. The
   * scheduled view's pair-display block uses it to render the
   * destination leg without re-running the matcher on it. */
  transferPairId: string | null;
}

function SortableTh<C extends string>({
  column,
  sortColumn,
  sortDir,
  onClick,
  align,
  className,
  children,
}: {
  column: C;
  sortColumn: C;
  sortDir: "asc" | "desc";
  onClick: (col: C) => void;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const active = column === sortColumn;
  return (
    <th className={`py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${className ?? "px-2"}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick(column);
        }}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${
          active ? "text-foreground" : ""
        } ${align === "right" ? "ml-auto" : ""}`}
      >
        {children}
        {active && (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </button>
    </th>
  );
}

function nextOccurrenceDate(s: ScheduledRow): string {
  if (s.frequency === "once") return s.startDate;
  const today = new Date();
  const horizon = addMonths(today, 24);
  const projected = expandRecurrence(s as unknown as ScheduledTransaction, today, horizon);
  return projected[0]?.date ?? s.startDate;
}

// Approximate cadence in days. Used only to walk a future-dated schedule
// backwards into the matching window — expandRecurrence handles the precise
// stepping (e.g. month-end snap) once the synthetic startDate is set.
const APPROX_CADENCE_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  fortnightly: 14,
  monthly: 30,
  quarterly: 91,
  yearly: 365,
};

// Occurrences per week, used to convert a schedule's amount into a
// weekly-equivalent for at-a-glance budgeting comparisons.
const WEEKLY_FACTOR: Record<string, number> = {
  daily: 7,
  weekly: 1,
  fortnightly: 0.5,
  monthly: 12 / 52,
  quarterly: 4 / 52,
  yearly: 1 / 52,
};

/**
 * Unused-budget gap for a matched transaction against a range schedule.
 * Returns max−actual when actual < max; null for non-range schedules and
 * for matches that hit max (or above). Surfaced as a dedicated "Gap" column
 * in the matched list and as a stacked bar segment on the chart.
 */
function rangeGap(
  txnAmount: number,
  seg: { expectedAmount: number; amountMin?: number },
): number | null {
  if (seg.amountMin == null) return null;
  const gap = Math.abs(seg.expectedAmount) - Math.abs(txnAmount);
  return gap > 0.005 ? gap : null;
}

function weeklyFactor(s: { frequency: string; interval: number | null }): number {
  if (s.frequency === "once") return 0;
  const factor = WEEKLY_FACTOR[s.frequency] ?? 0;
  return factor / (s.interval || 1);
}

// If a schedule's startDate is in the future (relative to today), step it
// backwards in cadence increments so historical transactions can match a
// schedule that was added with a forward-looking startDate. Schedules whose
// start is already in the past anchor on the real startDate — backdating
// those would invent occurrences before the user actually had the bill,
// which surface as phantom missed entries.
function effectiveStartForMatching(s: ScheduledRow, windowFrom: Date): string {
  if (s.frequency === "once") return s.startDate;
  const start = parseISO(s.startDate);
  const today = new Date();
  if (start.getTime() <= today.getTime()) return s.startDate;
  const cadence = (APPROX_CADENCE_DAYS[s.frequency] ?? 30) * (s.interval || 1);
  const daysAhead = Math.ceil((start.getTime() - windowFrom.getTime()) / 86_400_000);
  // +2 cadences of slack so expandRecurrence's fast-forward has a stable anchor.
  const stepsBack = Math.ceil(daysAhead / cadence) + 2;
  const synthetic = new Date(start);
  synthetic.setUTCDate(synthetic.getUTCDate() - stepsBack * cadence);
  return synthetic.toISOString().slice(0, 10);
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

// Convert a list-view row into the shape ScheduledEditForm expects when
// pre-filling a draft (id is left blank because the form is in create mode).
function toFormRow(s: ScheduledRow): ScheduledFormRow {
  return {
    id: "",
    kind: s.kind,
    payee: s.payee,
    description: s.description,
    amount: s.amount,
    amountMin: s.amountMin,
    type: s.type,
    frequency: s.frequency,
    interval: s.interval,
    startDate: s.startDate,
    endDate: s.endDate,
    isActive: s.isActive,
    dayOfMonth: s.dayOfMonth,
    accountId: s.accountId,
    categoryId: s.categoryId,
    transferToAccountId: s.transferToAccountId,
  };
}

interface ForecastRow {
  scheduledId: string;
  occurrenceDate: string;
  amount: string;
}

// How many future occurrences to project per active schedule. Each one shows
// up as a forecast bar on the chart and gets a row in the form's Upcoming
// Forecast section.
// FORECAST_HORIZON now lives in src/lib/forecast.ts so this view and
// scheduled-forecast-rows.tsx stay in lockstep.

export function ScheduledListView({
  scheduled: allScheduled,
  accounts,
  categories,
  forecasts: forecastList,
}: {
  scheduled: ScheduledRow[];
  accounts: AccountLite[];
  categories: Pick<Category, "id" | "name" | "parentId">[];
  forecasts: ForecastRow[];
}) {
  // Honour the global account filter from the sidebar. Empty set = no filter.
  // A schedule is in-scope when it touches at least one selected account
  // (source side OR — for transfers — the destination side).
  //
  // The page-level toggle (`scheduledAccountFilterMode`) can opt out of the
  // sidebar filter entirely — in "all" mode every schedule is in-scope
  // regardless of which accounts the sidebar has selected, which matches
  // the budget-planning use of this page. "selected" mode defers to the
  // sidebar like the rest of the app.
  const { ids: rawAccountFilterIds } = useAccountFilter();
  const { prefs: displayPrefsForFilter } = useDisplayPrefs();
  const accountFilterIds =
    displayPrefsForFilter.scheduledAccountFilterMode === "all"
      ? []
      : rawAccountFilterIds;

  // Server-side render and the first client render disagree on `new Date()`
  // when their timezones differ (UTC server vs. local client), which produces
  // hydration mismatches on the Date column. Defer date-derived output until
  // the client has mounted so the SSR pass renders a stable placeholder.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Ref on the matched-list scroll container so a chart-bar click can scroll
  // the matching txn group into view via `data-bar-date` attributes set on
  // each row.
  const matchedListRef = useRef<HTMLDivElement | null>(null);
  function handleChartBarClick(date: string) {
    const root = matchedListRef.current;
    if (!root) return;
    // CSS.escape isn't quite right for an attribute *value* on every browser
    // version, but ISO-formatted dates only contain digits and hyphens, both
    // safe inside an attribute selector.
    const target = root.querySelector(`[data-bar-date='${date}']`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
  const scheduled = useMemo(() => {
    if (accountFilterIds.length === 0) return allScheduled;
    const allow = new Set(accountFilterIds);
    return allScheduled.filter(
      (s) =>
        // Budgets with no account apply across all accounts, so they should
        // appear regardless of the active account filter.
        s.accountId == null ||
        allow.has(s.accountId) ||
        (s.transferToAccountId ? allow.has(s.transferToAccountId) : false),
    );
  }, [allScheduled, accountFilterIds]);

  // Transfers are stored from the source-leg perspective (negative amount).
  // When the filter is set to *only* the destination side of a transfer, flip
  // the sign so the row reads as incoming income for that account.
  //
  // "Internal" transfers (asset-to-asset between two of your operating
  // accounts — checking/savings/cash) net to zero in the total because no
  // money leaves your asset pool. Asset-to-liability transfers (paying off a
  // loan or credit card) are real cashflow and stay at their raw amount even
  // when both sides are in the filter — the cash actually left the asset
  // pool to extinguish debt. "All accounts" (empty filter) treats every
  // account as in-scope for the internal-vs-external decision.
  const effectiveAmount = useMemo(() => {
    const filter = new Set(accountFilterIds);
    const filterIsAll = accountFilterIds.length === 0;
    const acctById = new Map(accounts.map((a) => [a.id, a]));
    // An "operating asset" is part of the spending pool: transfers between
    // two operating assets net to zero. Liability types (loan, credit) and
    // user-flagged externals (Savings, Emergency, etc. via isExternal) drop
    // out of the pool, so transfers touching them count as real cashflow.
    const isPoolAsset = (id: string | null | undefined): boolean => {
      if (!id) return false;
      const a = acctById.get(id);
      if (!a) return false;
      if (a.isExternal) return false;
      return a.type === "checking" || a.type === "savings" || a.type === "cash";
    };
    return (s: ScheduledRow): number => {
      const raw = parseFloat(s.amount);
      if (s.type !== "transfer" || !s.transferToAccountId || !s.accountId) return raw;
      const sourceInFilter = filterIsAll || filter.has(s.accountId);
      const destInFilter = filterIsAll || filter.has(s.transferToAccountId);
      const internalAssetTransfer =
        isPoolAsset(s.accountId) && isPoolAsset(s.transferToAccountId);
      if (sourceInFilter && destInFilter && internalAssetTransfer) return 0;
      if (destInFilter && !sourceInFilter) return -raw;
      return raw;
    };
  }, [accountFilterIds, accounts]);
  const effectiveWeekly = (s: ScheduledRow) => effectiveAmount(s) * weeklyFactor(s);

  // A row is "superseded" when it has been replaced — inactive AND there is a
  // sibling in the same lineage with a later startDate. Concurrent active
  // siblings are NOT superseded; they're just multiple schedules in one group.
  const latestStartByLineage = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of scheduled) {
      const cur = map.get(s.lineageId);
      if (!cur || s.startDate > cur) map.set(s.lineageId, s.startDate);
    }
    return map;
  }, [scheduled]);
  const isSuperseded = (s: ScheduledRow) =>
    !s.isActive && (latestStartByLineage.get(s.lineageId) ?? s.startDate) > s.startDate;

  // Group all schedules by lineage. Each group renders as a single row in the
  // list; the inline expansion shows a table of every member plus a compact
  // edit form.
  interface Group {
    lineageId: string;
    members: ScheduledRow[];      // all members (sorted by startDate desc)
    activeMembers: ScheduledRow[];
    primary: ScheduledRow;        // headline schedule for the list row
    hasActive: boolean;
  }
  const groups = useMemo<Group[]>(() => {
    const byLineage = new Map<string, ScheduledRow[]>();
    for (const s of scheduled) {
      const arr = byLineage.get(s.lineageId) ?? [];
      arr.push(s);
      byLineage.set(s.lineageId, arr);
    }
    const out: Group[] = [];
    for (const [lineageId, members] of byLineage) {
      // Newest startDate first so the predecessor sits below the latest in the
      // table — natural reading order for a rate-change history.
      members.sort((a, b) => (a.startDate > b.startDate ? -1 : 1));
      const activeMembers = members.filter((m) => m.isActive);
      const primary = activeMembers[0] ?? members[0];
      out.push({ lineageId, members, activeMembers, primary, hasActive: activeMembers.length > 0 });
    }
    out.sort((a, b) => a.primary.startDate.localeCompare(b.primary.startDate));
    return out;
  }, [scheduled]);
  const activeGroups = groups.filter((g) => g.hasActive);
  const inactiveGroups = groups.filter((g) => !g.hasActive);

  // "Expanded group" is derived: the group whose lineage contains the selected
  // schedule. Single source of truth — clicking a list row sets selectedId,
  // and the right panel keys off that.
  const [addingTo, setAddingTo] = useState<string | null>(null);
  // Right-panel transaction lists scope to the selected lineage member when
  // the lineage has multiple. This toggle lets the user temporarily see the
  // full unfiltered list across all lineage members. Auto-on whenever a
  // selection lands on a multi-member lineage (see effect after selectedId).
  const [showAll, setShowAll] = useState(false);

  // Synchronous latch on in-flight add-to-group POSTs. The reactive `addingTo`
  // state alone isn't enough — two clicks within the same render tick both
  // see the old value and both POST, creating duplicate drafts. The ref is
  // checked-and-set synchronously in the same tick.
  const addingLineageIdsRef = useRef<Set<string>>(new Set());

  async function addToGroup(g: Group) {
    if (addingLineageIdsRef.current.has(g.lineageId)) return;
    addingLineageIdsRef.current.add(g.lineageId);
    setAddingTo(g.lineageId);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch("/api/scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: g.primary.accountId,
          type: g.primary.type,
          // Sign convention: stored amount carries the type's sign.
          amount:
            g.primary.type === "expense" || g.primary.type === "transfer" ? "-0.00" : "0.00",
          categoryId: g.primary.categoryId,
          transferToAccountId: g.primary.transferToAccountId,
          frequency: g.primary.frequency,
          interval: g.primary.interval,
          startDate: today,
          dayOfMonth: g.primary.dayOfMonth,
          lineageId: g.lineageId,
        }),
      });
      if (!res.ok) {
        toast.error("Failed to add schedule");
        return;
      }
      const created = await res.json();
      toast.success("Added — fill in payee and amount");
      router.refresh();
      invalidateCashflow();
      setSelectedId(created.id);
    } finally {
      addingLineageIdsRef.current.delete(g.lineageId);
      setAddingTo(null);
    }
  }

  const router = useRouter();
  const searchParams = useSearchParams();
  // Optional ?id=<scheduledId> deep-link — used by the matched-schedule
  // pill on the transactions page so clicking it lands on this page
  // with the right row already selected.
  const urlSelectedId = searchParams.get("id") ?? "";
  const [selectedId, setSelectedId] = useState<string>(urlSelectedId);
  // Once the schedules list has loaded, honour the URL id by selecting
  // that row. Skipped after the first hit so the user can manually pick
  // a different row without the URL param dragging them back.
  const didHonourUrlIdRef = useRef(false);
  useEffect(() => {
    if (didHonourUrlIdRef.current) return;
    if (!urlSelectedId) return;
    if (scheduled.length === 0) return;
    if (scheduled.some((s) => s.id === urlSelectedId)) {
      setSelectedId(urlSelectedId);
      didHonourUrlIdRef.current = true;
    }
  }, [urlSelectedId, scheduled]);
  // No auto-select on cold load when the URL has no `?id=`. The
  // eager auto-pick used to fire a ~10 k-row `/api/transactions`
  // fetch for the right panel on every naked `/scheduled` nav,
  // which is wasted work for users arriving without a specific
  // schedule in mind. They click a row and the panel populates one
  // tick later. (The `urlSelectedId` effect above still honours
  // `?id=` deep-links.)

  // Auto-toggle showAll when the user picks a different schedule. Multi-member
  // lineages default to the unified view (almost always what the user wants);
  // single-member ones default off (the toggle is hidden anyway).
  useEffect(() => {
    if (!selectedId) return;
    const sel = scheduled.find((s) => s.id === selectedId);
    if (!sel) return;
    const lineageSize = scheduled.filter(
      (s) => s.lineageId === sel.lineageId,
    ).length;
    setShowAll(lineageSize > 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  type SortColumn = "next" | "frequency" | "payee" | "amount" | "weekly";
  type SortDir = "asc" | "desc";
  const [sortColumn, setSortColumn] = useState<SortColumn>("next");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // User-tunable display knobs. Hidden columns also reset their sort
  // to "next" so the user isn't accidentally sorted by something they
  // can't see.
  const { prefs: displayPrefs } = useDisplayPrefs();
  const showWeekly = displayPrefs.scheduledShowWeekly;
  const effectiveSortColumn: SortColumn =
    !showWeekly && sortColumn === "weekly" ? "next" : sortColumn;
  function toggleSort(col: SortColumn) {
    if (col === sortColumn) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDir("asc");
    }
  }
  function sortGroups(gs: Group[]): Group[] {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...gs].sort((a, b) => {
      switch (effectiveSortColumn) {
        case "next": {
          const aDate = nextOccurrenceDate(a.primary);
          const bDate = nextOccurrenceDate(b.primary);
          return aDate.localeCompare(bDate) * factor;
        }
        case "frequency": {
          const freqOrder = ["once", "daily", "weekly", "fortnightly", "monthly", "quarterly", "yearly"];
          const aIdx = freqOrder.indexOf(a.primary.frequency);
          const bIdx = freqOrder.indexOf(b.primary.frequency);
          if (aIdx !== bIdx) return (aIdx - bIdx) * factor;
          return ((a.primary.interval ?? 1) - (b.primary.interval ?? 1)) * factor;
        }
        case "payee": {
          const aP = (a.primary.payee || a.primary.description || "").toLowerCase();
          const bP = (b.primary.payee || b.primary.description || "").toLowerCase();
          return aP.localeCompare(bP) * factor;
        }
        case "amount": {
          const aT = a.activeMembers.reduce((s, m) => s + effectiveAmount(m), 0);
          const bT = b.activeMembers.reduce((s, m) => s + effectiveAmount(m), 0);
          return (aT - bT) * factor;
        }
        case "weekly": {
          const aT = a.activeMembers.reduce((s, m) => s + effectiveWeekly(m), 0);
          const bT = b.activeMembers.reduce((s, m) => s + effectiveWeekly(m), 0);
          return (aT - bT) * factor;
        }
      }
    });
  }
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Migrate-to-parent: clicking the lineage row's Migrate button stashes the
  // member here, opens the New Scheduled dialog pre-filled, and on save the
  // original row is deleted so the entry "moves" out of the lineage.
  const [migrating, setMigrating] = useState<ScheduledRow | null>(null);

  async function performDelete(ids: string[]) {
    setDeleting(true);
    let res: Response;
    if (ids.length === 1) {
      res = await fetch(`/api/scheduled/${ids[0]}`, { method: "DELETE" });
    } else {
      res = await fetch("/api/scheduled/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
    }
    setDeleting(false);
    if (res.ok) {
      toast.success(ids.length === 1 ? "Scheduled deleted" : `Deleted ${ids.length} scheduled`);
      setConfirmDelete(null);
      // If the currently-selected detail row was deleted, try to
      // pin selection onto another surviving member of the same
      // lineage — staying inside the same group is far less
      // jarring than getting punted back to an unselected list.
      // Only fall back to clearing when nothing in the lineage
      // survived.
      if (ids.includes(selectedId)) {
        const selectedRow = scheduled.find((s) => s.id === selectedId);
        const fallback = selectedRow
          ? scheduled.find(
              (s) =>
                s.lineageId === selectedRow.lineageId && !ids.includes(s.id),
            )
          : undefined;
        setSelectedId(fallback?.id ?? "");
      }
      router.refresh();
      invalidateCashflow();
    } else {
      toast.error("Failed to delete");
    }
  }
  const selected = scheduled.find((s) => s.id === selectedId) ?? null;

  // Pull the selected row into view whenever the selected lineage changes —
  // covers the deep-link case (?id=…) where the row could be far down the
  // list, and is a no-op when it's already on screen ("nearest" block).
  useEffect(() => {
    const lineageId = selected?.lineageId;
    if (!lineageId) return;
    const el = document.querySelector<HTMLElement>(
      `tr[data-lineage-id="${lineageId}"]`,
    );
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected?.lineageId]);

  // Window for matching: rolling N-month look-back from today, where N
  // is user-controlled via the dropdown in the details title (default
  // 6m). DB-backed via displayPrefs so the preference follows the
  // operator across devices.
  const { prefs: matchPrefs, setPref: setMatchPref } = useDisplayPrefs();
  const storedWindow = matchPrefs.scheduledMatchWindowMonths;
  const matchWindowMonths = MATCH_WINDOW_OPTIONS.some((o) => o.months === storedWindow)
    ? storedWindow
    : DEFAULT_MATCH_WINDOW_MONTHS;
  function setMatchWindowPersisted(months: number) {
    setMatchPref("scheduledMatchWindowMonths", months);
  }
  const today = new Date();
  const fromISO = toISO(subMonths(today, matchWindowMonths));
  const toISOStr = toISO(today);

  // Collect every account this scheduled hits (transfers touch two accounts),
  // then narrow further by the global sidebar account filter when set so the
  // matched and category lists honour the same scope as the schedule list.
  // Transfers are an exception: both legs must be fetched even if only one
  // side is in the global filter, otherwise the pair can never match.
  const accountIds = useMemo(() => {
    if (!selected) return [];
    const ids = new Set<string>();
    if (selected.accountId) ids.add(selected.accountId);
    if (selected.transferToAccountId) ids.add(selected.transferToAccountId);
    const isTransferSchedule = selected.type === "transfer";
    if (!isTransferSchedule && accountFilterIds.length > 0) {
      const allow = new Set(accountFilterIds);
      for (const id of Array.from(ids)) if (!allow.has(id)) ids.delete(id);
    }
    return Array.from(ids);
  }, [selected, accountFilterIds]);

  // Budgets with no account scope sum across all accounts, so fetch the
  // window with no account filter rather than null-no-op.
  const isAllAccountsBudget = selected?.kind === "budget" && !selected?.accountId;
  // 10k limit so a high-volume everyday account (1k+ txns/yr) doesn't truncate
  // the oldest months — the matcher needs every candidate in-window or
  // expected occurrences with no nearby fetched txn show up as missed.
  const txKey = selected && (accountIds.length > 0 || isAllAccountsBudget)
    ? `/api/transactions?${accountIds.length > 0 ? `accountIds=${accountIds.join(",")}&` : ""}from=${fromISO}&to=${toISOStr}&limit=10000`
    : null;
  const { data: txns = [], isLoading: txLoading } = useSwrJson<TxRow[]>(txKey);

  // When the schedule has a category, also fetch every txn in that category
  // (and its descendants) over the same window. The right-panel list is built
  // from this set rather than the account-filtered one, so the user sees one
  // unified view of category spending, with each row coloured by whichever
  // lineage segment claimed it (or neutral for unmatched in-category).
  const catAccountFilter = accountFilterIds.length > 0 ? `&accountIds=${accountFilterIds.join(",")}` : "";
  // Budgets aggregate every txn in the category subtree across the rolling
  // window, so cap the fetch at a much higher limit than the per-occurrence
  // matcher needs — otherwise 12 months of activity in a busy category gets
  // truncated and older budget periods read as zero spent.
  const catKey = selected && selected.categoryId
    ? `/api/transactions?categoryId=${selected.categoryId}&includeChildren=true&from=${fromISO}&to=${toISOStr}&limit=10000${catAccountFilter}`
    : null;
  const { data: catTxns = [], isLoading: catLoading } = useSwrJson<TxRow[]>(catKey);

  // Per-budget current-period progress, fetched once for all budgets in the
  // list. Keyed by scheduledId so a row can look up its own progress without
  // computing client-side aggregation across (potentially) all transactions.
  interface BudgetProgress {
    scheduledId: string;
    periodFrom: string;
    periodTo: string;
    spent: string;
    cap: string;
  }
  const { data: budgetProgressList = [] } = useSwrJson<BudgetProgress[]>(
    "/api/scheduled/budget-progress",
  );
  const budgetProgressById = useMemo(() => {
    const m = new Map<string, BudgetProgress>();
    for (const p of budgetProgressList) m.set(p.scheduledId, p);
    return m;
  }, [budgetProgressList]);

  // Walk every sibling in the lineage so a schedule whose price changed
  // mid-life shows the older payments matched against their original amount.
  // Each sibling is matched within its own effective window (clamped by
  // startDate/endDate); claims are global so a real txn never gets attributed
  // to two segments.
  const { matchedReals, unmatchedOccurrences, segmentResults } = useMemo(() => {
    type SegResult = {
      schedule: ScheduledRow;
      matchedTxnIds: Map<string, { occurrenceDate: string }>;
      missed: { date: string; accountId: string; amount: number }[];
    };
    const empty = {
      matchedReals: new Map<string, { occurrenceDate: string; segmentId: string }>(),
      unmatchedOccurrences: [] as { date: string; accountId: string; amount: number; segmentId: string }[],
      segmentResults: [] as SegResult[],
    };
    // Budgets aggregate from catTxns (category-scoped), so allow empty txns
    // when the selected row is a budget — its segment is still meaningful.
    if (!selected) return empty;
    if (txns.length === 0 && selected.kind !== "budget") return empty;

    // Range schedules need a category-scoped candidate pool — otherwise any
    // unrelated txn whose magnitude lands in the band gets claimed (e.g. a
    // $280 retail purchase masquerading as a water bill).
    const childrenByParent = new Map<string, string[]>();
    for (const c of categories) {
      if (c.parentId) {
        const arr = childrenByParent.get(c.parentId) ?? [];
        arr.push(c.id);
        childrenByParent.set(c.parentId, arr);
      }
    }
    function descendantSet(rootId: string): Set<string> {
      const out = new Set<string>([rootId]);
      const stack = [rootId];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const child of childrenByParent.get(cur) ?? []) {
          if (!out.has(child)) {
            out.add(child);
            stack.push(child);
          }
        }
      }
      return out;
    }

    const siblings = scheduled
      .filter((s) => s.lineageId === selected.lineageId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
    const windowFromDate = parseISO(fromISO);
    const windowToDate = parseISO(toISOStr);
    const claimedTxnIds = new Set<string>();
    const matched = new Map<string, { occurrenceDate: string; segmentId: string }>();
    const missedAll: { date: string; accountId: string; amount: number; segmentId: string }[] = [];
    const segs: SegResult[] = [];

    for (const sib of siblings) {
      // Budgets are period-aggregates rather than per-occurrence matches;
      // the matcher loop would emit a flood of bogus "missed" entries for
      // each projected cap. Skip them and let the budget aggregator render
      // them via budgetProgressById instead.
      if (sib.kind === "budget") {
        segs.push({ schedule: sib, matchedTxnIds: new Map(), missed: [] });
        continue;
      }
      // Drafts (amount = 0) shouldn't run the matcher: at $0 ± $0.01 tolerance
      // they'd claim nothing AND emit a flood of $0 missed occurrences. Skip
      // them entirely so the right panel stays usable while the user is
      // figuring out what value to enter.
      if (parseFloat(sib.amount) === 0) {
        segs.push({ schedule: sib, matchedTxnIds: new Map(), missed: [] });
        continue;
      }
      const sibStart = parseISO(sib.startDate);
      const sibEnd = sib.endDate ? parseISO(sib.endDate) : windowToDate;
      const segWindowFrom = sibStart > windowFromDate ? sibStart : windowFromDate;
      const segWindowTo = sibEnd < windowToDate ? sibEnd : windowToDate;
      if (segWindowFrom > segWindowTo) {
        segs.push({ schedule: sib, matchedTxnIds: new Map(), missed: [] });
        continue;
      }

      const matchingStart = effectiveStartForMatching(sib, segWindowFrom);
      const scheduleForMatch = { ...sib, startDate: matchingStart };
      // Single-leg projection for transfers: the destination's existence
      // is established by the source-leg match's transfer_pair_id (see
      // transferPairRows below). Projecting both legs would force the
      // destination through matchSchedule's category filter, which it
      // typically fails because auto-pairing only categorises the source
      // — surfacing the destination as a false "missed" occurrence.
      const projected = expandRecurrence(
        scheduleForMatch as unknown as ScheduledTransaction,
        segWindowFrom,
        segWindowTo,
        { transferDualLeg: false },
      );

      const segMatched = new Map<string, { occurrenceDate: string }>();
      const segMissed: { date: string; accountId: string; amount: number }[] = [];

      // Range-mode: amountMin defines a band [amountMin, |amount|]. The matcher
      // accepts any txn whose magnitude lands in the band (sign must agree with
      // the schedule's expected direction).
      const rangeMin = sib.amountMin != null ? Math.abs(parseFloat(sib.amountMin)) : null;
      // Whenever the schedule has a category, only consider txns filed in that
      // category subtree — otherwise a same-account, same-amount txn under a
      // different category would be claimed by this schedule, leaving the
      // category-filtered list and the chart disagreeing.
      const allowedCats = sib.categoryId ? descendantSet(sib.categoryId) : null;

      const result = matchSchedule(
        projected.map((p) => ({
          date: p.date,
          accountId: p.accountId,
          amount: parseFloat(p.amount),
        })),
        txns,
        {
          rangeMin,
          frequency: sib.frequency,
          interval: sib.interval,
          allowedCategoryIds: allowedCats,
          scheduleStartDate: sib.startDate,
          scheduleEndDate: sib.endDate,
          claimedTxnIds,
        },
      );
      for (const m of result.matched) {
        segMatched.set(m.txnId, { occurrenceDate: m.occurrence.date });
        matched.set(m.txnId, { occurrenceDate: m.occurrence.date, segmentId: sib.id });
      }
      for (const u of result.unmatched) {
        segMissed.push({ date: u.date, accountId: u.accountId, amount: u.amount });
        missedAll.push({ date: u.date, accountId: u.accountId, amount: u.amount, segmentId: sib.id });
      }

      segs.push({ schedule: sib, matchedTxnIds: segMatched, missed: segMissed });
    }

    return { matchedReals: matched, unmatchedOccurrences: missedAll, segmentResults: segs };
  }, [selected, scheduled, txns, fromISO, toISOStr, categories]);

  const matchedRows = txns
    .filter((t) => matchedReals.has(t.id))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const isTransfer = selected?.type === "transfer";

  // Transfer pair view: for each occurrence date, group source-leg and dest-leg
  // matches into one row so the two accounts render side-by-side. Falls back to
  // a placeholder cell when one leg didn't match a real transaction.
  type TransferPairRow = {
    date: string;
    source: { txn?: TxRow; expectedAmount: number; accountId: string };
    dest: { txn?: TxRow; expectedAmount: number; accountId: string } | null;
  };
  const transferPairRows: TransferPairRow[] = useMemo(() => {
    if (!isTransfer || !selected || !selected.accountId) return [];
    const sourceAccountId = selected.accountId;
    const destAccountId = selected.transferToAccountId;
    const sourceAmt = parseFloat(selected.amount);
    const destAmt = -sourceAmt;
    const dateSet = new Set<string>();
    for (const [, m] of matchedReals) dateSet.add(m.occurrenceDate);
    for (const u of unmatchedOccurrences) dateSet.add(u.date);
    // Index by id for the destination-leg lookup below.
    const txnById = new Map(txns.map((t) => [t.id, t]));
    const rows: TransferPairRow[] = Array.from(dateSet).map((date) => {
      const sourceTxn = txns.find(
        (t) =>
          t.accountId === sourceAccountId &&
          matchedReals.get(t.id)?.occurrenceDate === date,
      );
      // Destination leg: walk the source's transfer_pair_id rather than
      // re-running matchSchedule on the dest account. This is the half
      // of the bug fix that surfaces the paired row in the UI — without
      // it, the pair-display had to find the dest txn via the same
      // matcher pass that produced the false-positive "missed" warning.
      let destTxn: TxRow | undefined;
      if (destAccountId) {
        if (sourceTxn?.transferPairId) {
          const paired = txnById.get(sourceTxn.transferPairId);
          if (paired && paired.accountId === destAccountId) destTxn = paired;
        }
        if (!destTxn) {
          // Fallback for manually-paired rows whose other leg isn't in
          // the local txn pool (archived counterparty etc.) — leave
          // destTxn undefined so the existing "no match" UI renders.
        }
      }
      return {
        date,
        source: { txn: sourceTxn, expectedAmount: sourceAmt, accountId: sourceAccountId },
        dest: destAccountId
          ? { txn: destTxn, expectedAmount: destAmt, accountId: destAccountId }
          : null,
      };
    });
    return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [isTransfer, selected, matchedReals, unmatchedOccurrences, txns]);

  // Unified category list: every txn in the schedule's category over the
  // window, plus any missed occurrences interleaved by date so the user sees
  // the full chronology in one list. Each row is annotated with the lineage
  // segment that claimed it (matched) or that expected it (missed).
  //
  // When the selected schedule is one specific member of a multi-member
  // lineage, narrow the list to that segment: keep only matches/missed tagged
  // with the selected segment, plus any unmatched-in-category transactions
  // that fall inside the segment's effective date window.
  type CategoryListRow =
    | {
        kind: "txn";
        date: string;
        txn: TxRow;
        segmentId: string | null;
        /** When the selected schedule is a budget, this is the index of the
         * past period containing the txn (0 = oldest). Lets the row pick a
         * per-period colour from the lineage palette. Null for non-budget
         * rows. */
        periodIndex?: number | null;
      }
    | { kind: "missed"; date: string; accountId: string; amount: number; segmentId: string };
  const categoryListRows = useMemo<CategoryListRow[]>(() => {
    if (!selected?.categoryId) return [];
    const isBudget = selected.kind === "budget";
    // For budgets, build the period table so each in-subtree txn can be
    // tagged with its period index and rendered in a per-period colour.
    const budgetPeriods = isBudget
      ? pastBudgetPeriods(selected.startDate, selected.frequency, new Date(), fromISO)
      : [];
    const periodIndexFor = (date: string): number | null => {
      for (let i = 0; i < budgetPeriods.length; i++) {
        const p = budgetPeriods[i];
        if (date >= p.from && date <= p.to) return i;
      }
      return null;
    };
    // Range mode: hide unmatched in-category txns whose magnitude is outside
    // the schedule's [amountMin, |amount|] band — they aren't candidates for
    // this bill and just clutter the list (e.g. $20 grocery runs against a
    // $400-700 monthly Food schedule).
    const rangeMin = selected.amountMin != null
      ? Math.abs(parseFloat(selected.amountMin))
      : null;
    const rangeMax = rangeMin !== null ? Math.abs(parseFloat(selected.amount)) : null;
    const inBand = (amountStr: string) => {
      if (rangeMin === null || rangeMax === null) return true;
      const mag = Math.abs(parseFloat(amountStr));
      return mag >= rangeMin - 0.01 && mag <= rangeMax + 0.01;
    };
    const txnRows: CategoryListRow[] = catTxns
      .filter((t) => {
        // Budgets: only count txns from the budget's startDate onwards —
        // earlier-dated txns aren't part of any budget period.
        if (isBudget && t.date < selected.startDate) return false;
        // Matched txns always pass (they're already in the band by virtue of
        // having been claimed). Unmatched in-category get the band filter.
        if (matchedReals.has(t.id)) return true;
        return inBand(t.amount);
      })
      .map((t) => ({
        kind: "txn",
        date: t.date,
        txn: t,
        // For budgets, every in-period in-subtree txn is "claimed" by the
        // budget for rendering purposes, so the row gets a colour stripe and
        // the user can see at a glance which period each txn belongs to.
        segmentId: isBudget ? selected.id : (matchedReals.get(t.id)?.segmentId ?? null),
        periodIndex: isBudget ? periodIndexFor(t.date) : null,
      }));
    const missedRows: CategoryListRow[] = unmatchedOccurrences.map((o) => ({
      kind: "missed",
      date: o.date,
      accountId: o.accountId,
      amount: o.amount,
      segmentId: o.segmentId,
    }));
    const all = [...txnRows, ...missedRows].sort((a, b) => (a.date < b.date ? 1 : -1));
    // Drafts (amount = 0): user needs the full category history so they can
    // pick a sensible amount. Skip both lineage and date scoping.
    if (parseFloat(selected.amount) === 0) return all;
    // "Show all" override — user wants every category txn regardless of segment.
    if (showAll) return all;
    const lineageSize = scheduled.filter((s) => s.lineageId === selected.lineageId).length;
    if (lineageSize <= 1) return all;
    const segStart = selected.startDate;
    const segEnd = selected.endDate ?? "9999-12-31";
    return all.filter((row) => {
      if (row.kind === "missed") return row.segmentId === selected.id;
      if (row.segmentId) return row.segmentId === selected.id;
      // Unmatched-in-category: include only if its date falls inside the
      // selected segment's effective window.
      return row.date >= segStart && row.date <= segEnd;
    });
  }, [selected, scheduled, catTxns, matchedReals, unmatchedOccurrences, showAll]);

  // Forecast lookup — per-schedule, keyed by occurrence date.
  const forecastByScheduleAndDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const f of forecastList) {
      const inner = map.get(f.scheduledId) ?? new Map<string, number>();
      inner.set(f.occurrenceDate, parseFloat(f.amount));
      map.set(f.scheduledId, inner);
    }
    return map;
  }, [forecastList]);

  // Compute the next FORECAST_HORIZON projected occurrences for a schedule
  // (only its active window, dates after today). Each projection picks up an
  // explicit forecast amount if one exists; otherwise it falls back to the
  // schedule's standard amount.
  function projectForwardForecasts(s: ScheduledRow): { date: string; amount: number }[] {
    if (!s.isActive) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString().slice(0, 10);
    const sibStart = parseISO(s.startDate);
    const sibEnd = s.endDate ? parseISO(s.endDate) : addMonths(today, 36);
    const fromDate = sibStart > today ? sibStart : today;
    if (fromDate > sibEnd) return [];

    const projected = expandRecurrence(
      s as unknown as ScheduledTransaction,
      fromDate,
      sibEnd,
    );
    const futureOccurrences = projected
      .filter((o) => o.date > todayISO)
      .slice(0, FORECAST_HORIZON);

    const fcMap = forecastByScheduleAndDate.get(s.id);
    return futureOccurrences.map((o) => ({
      date: o.date,
      amount: fcMap?.get(o.date) ?? parseFloat(s.amount),
    }));
  }

  // Build chart segments — one per sibling in the lineage. Latest segment uses
  // the schedule's frequency colour; older predecessors cycle through a
  // distinct-hue palette (rose/indigo/amber/teal/purple) via colourForLineageRank.
  // For transfer schedules we chart only the source leg (the destination amount
  // is the same magnitude with the opposite sign, so it'd just mirror).
  //
  // When the selected schedule is one specific member of a multi-member
  // lineage (and not a draft), narrow the chart to just that segment so it
  // matches the scoping the transaction lists already apply.
  const chartSegments: ChartSegment[] = useMemo(() => {
    if (segmentResults.length === 0) return [];
    const freq = selected?.frequency ?? "monthly";
    const isDraft = selected ? parseFloat(selected.amount) === 0 : false;
    const lineageSize = selected
      ? scheduled.filter((s) => s.lineageId === selected.lineageId).length
      : 0;
    const scopeToSelected = !!selected && !isDraft && lineageSize > 1 && !showAll;
    // Build a category subtree lookup once for any budget rows that need to
    // sum txns across descendants (matches the matcher's pattern).
    const childrenByParent = new Map<string, string[]>();
    for (const c of categories) {
      if (c.parentId) {
        const arr = childrenByParent.get(c.parentId) ?? [];
        arr.push(c.id);
        childrenByParent.set(c.parentId, arr);
      }
    }
    function descendantSet(rootId: string): Set<string> {
      const seen = new Set<string>([rootId]);
      const stack = [rootId];
      while (stack.length) {
        const cur = stack.pop()!;
        for (const child of childrenByParent.get(cur) ?? []) {
          if (!seen.has(child)) {
            seen.add(child);
            stack.push(child);
          }
        }
      }
      return seen;
    }
    // segmentResults are sorted oldest → newest; reverse-rank for colour.
    const all = segmentResults.map((seg, i) => {
      const ageRank = segmentResults.length - 1 - i; // 0 = latest
      const colour = colourForLineageRank(ageRank, freq);
      const isTransferSeg = seg.schedule.type === "transfer";
      const isBudgetSeg = seg.schedule.kind === "budget";
      let matchedSource: { date: string; amount: number }[];
      let missedSource: { date: string; amount: number }[];
      let forecastSource: { date: string; amount: number }[];
      let amountMin: number | undefined;
      if (isBudgetSeg) {
        // Budget: one bar per past period, height = net spent in the budget's
        // direction (refunds reduce, expenses increase). Intentionally NOT
        // filtered by the budget's accountId — historical periods may have
        // had spending on accounts the budget no longer covers, and the
        // chart's job is to show category history, not just whatever the cap
        // currently scopes. The "this period" progress tile keeps the
        // accountId filter (server-side) so the cap math stays correct.
        // Source from catTxns (category-scoped, fetched at a higher limit)
        // so heavy-spend categories don't truncate older periods.
        const allowedCats = seg.schedule.categoryId
          ? descendantSet(seg.schedule.categoryId)
          : null;
        const budgetSource = seg.schedule.categoryId ? catTxns : txns;
        const periods = pastBudgetPeriods(
          seg.schedule.startDate,
          seg.schedule.frequency,
          new Date(),
          fromISO,
        );
        const budgetSign = parseFloat(seg.schedule.amount) >= 0 ? 1 : -1;
        matchedSource = periods.map((p, idx) => {
          const spent = budgetSource
            .filter(
              (t) =>
                t.date >= p.from &&
                t.date <= p.to &&
                (!allowedCats || (t.categoryId && allowedCats.has(t.categoryId))),
            )
            .reduce((sum, t) => sum + budgetSign * parseFloat(t.amount), 0);
          const periodColour = colourForBudgetPeriod(periods.length - 1 - idx);
          return { date: p.from, amount: spent, color: periodColour };
        });
        missedSource = [];
        // Forward forecast — project the next FORECAST_HORIZON budget periods
        // (skipping the in-progress one — the matched bar above already covers
        // that). Each bar's height is the cap (override if set, else the
        // schedule's standard amount), so the chart visualises the projected
        // spend window the user will be steering.
        forecastSource = (() => {
          if (!seg.schedule.isActive) return [];
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const cur = currentBudgetPeriod(seg.schedule.startDate, seg.schedule.frequency, today);
          let from = parseISO(cur.from);
          const stepFrom = (d: Date) => {
            switch (seg.schedule.frequency) {
              case "weekly": return addWeeks(d, 1);
              case "monthly": return addMonths(d, 1);
              case "quarterly": return addMonths(d, 3);
              case "yearly": return addYears(d, 1);
              default: return addMonths(d, 1);
            }
          };
          from = stepFrom(from);
          const end = seg.schedule.endDate ? parseISO(seg.schedule.endDate) : null;
          const fcMap = forecastByScheduleAndDate.get(seg.schedule.id);
          const standard = parseFloat(seg.schedule.amount);
          const out: { date: string; amount: number }[] = [];
          for (let i = 0; i < FORECAST_HORIZON; i++) {
            if (end && from > end) break;
            const iso = format(from, "yyyy-MM-dd");
            out.push({ date: iso, amount: fcMap?.get(iso) ?? standard });
            from = stepFrom(from);
          }
          return out;
        })();
        // Setting amountMin=0 routes the chart through its range-mode delta
        // logic so under-cap periods render with the slate "gap" segment up
        // to the cap, and over-cap periods render the orange overage on top.
        amountMin = 0;
      } else {
        matchedSource = isTransferSeg
          ? Array.from(seg.matchedTxnIds.entries())
              .map(([txnId, m]) => ({ txnId, ...m }))
              .map((m) => ({ ...m, txn: txns.find((t) => t.id === m.txnId) }))
              .filter((m) => m.txn?.accountId === seg.schedule.accountId)
              .map((m) => ({ date: m.occurrenceDate, amount: parseFloat(m.txn!.amount) }))
          : Array.from(seg.matchedTxnIds.entries())
              .map(([txnId, m]) => ({ txnId, ...m }))
              .map((m) => ({ date: m.occurrenceDate, amount: parseFloat(txns.find((t) => t.id === m.txnId)?.amount ?? "0") }));
        missedSource = isTransferSeg
          ? seg.missed.filter((m) => m.accountId === seg.schedule.accountId).map((m) => ({ date: m.date, amount: m.amount }))
          : seg.missed.map((m) => ({ date: m.date, amount: m.amount }));
        forecastSource = projectForwardForecasts(seg.schedule);
        amountMin = seg.schedule.amountMin != null ? parseFloat(seg.schedule.amountMin) : undefined;
      }
      const startMonth = format(parseISO(seg.schedule.startDate), "MMM yy");
      const amt = formatAUD(seg.schedule.amount).replace("A$", "$");
      const labelPrefix = isBudgetSeg ? "Cap" : "";
      return {
        id: seg.schedule.id,
        label: `${labelPrefix ? `${labelPrefix} ` : ""}${amt} from ${startMonth}`,
        color: colour,
        expectedAmount: parseFloat(seg.schedule.amount),
        amountMin,
        isTransfer: isTransferSeg,
        matched: matchedSource,
        missed: missedSource,
        forecast: forecastSource,
      };
    });
    return scopeToSelected ? all.filter((seg) => seg.id === selected!.id) : all;
  }, [segmentResults, selected, scheduled, txns, catTxns, forecastByScheduleAndDate, showAll, categories, fromISO]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));

  function renderGroup(g: Group) {
    const isSelected = selected?.lineageId === g.lineageId;
    const primary = g.primary;
    const isBudgetRow = primary.kind === "budget";
    const totalAmount = g.activeMembers.reduce((sum, m) => sum + effectiveAmount(m), 0);
    const totalWeekly = g.activeMembers.reduce((sum, m) => sum + effectiveWeekly(m), 0);
    const headlineLabel = primary.payee || primary.description || "—";
    const moreCount = g.activeMembers.length - 1;
    const nextDate = nextOccurrenceDate(primary);
    const progress = isBudgetRow ? budgetProgressById.get(primary.id) : null;
    const periodLabel = progress?.periodTo ? formatDate(progress.periodTo) : null;
    const spentNum = progress ? parseFloat(progress.spent) : 0;
    const capNum = Math.abs(parseFloat(primary.amount));
    const overCap = progress ? spentNum > capNum + 0.005 : false;
    return (
      <Fragment key={g.lineageId}>
      <tr
        data-lineage-id={g.lineageId}
        onClick={() => {
          if (isSelected) setSelectedId("");
          else setSelectedId(primary.id);
        }}
        className={`group cursor-pointer lg:border-b lg:last:border-b-0 ${
          isSelected
            ? "bg-indigo-500/30 dark:bg-indigo-500/40 hover:bg-indigo-500/35 dark:hover:bg-indigo-500/45"
            : "hover:bg-muted/50"
        }`}
      >
        <td className="pl-2 pr-2 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap w-px">
          {!mounted ? "—" : isBudgetRow ? (periodLabel ?? "—") : formatDate(nextDate)}
        </td>
        <td className="px-0 py-2 whitespace-nowrap w-px">
          <span
            className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
            style={{
              backgroundColor: isBudgetRow
                ? dimColour("#6366f1")
                : dimColour(colourForFrequency(primary.frequency)),
            }}
            title={isBudgetRow ? "Budget" : undefined}
          >
            {isBudgetRow
              ? `Budget · ${freqLabel(primary.frequency, 1)}`
              : freqLabel(primary.frequency, primary.interval)}
          </span>
        </td>
        <td className="hidden lg:table-cell px-2 py-2 max-w-0 w-full">
          {/* Hidden on mobile — the lg:hidden <tr> below renders the
              payee on its own full-width row at narrow widths. */}
          <div className="truncate" title={headlineLabel}>
            {headlineLabel}
            {moreCount > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">+{moreCount} more</span>
            )}
          </div>
        </td>
        <td className={`pl-2 pr-0 py-2 text-right text-sm font-semibold tabular-nums whitespace-nowrap w-px ${
          isBudgetRow
            ? overCap ? "text-red-500" : "text-foreground"
            : amountClass(totalAmount)
        }`}>
          {isBudgetRow ? (
            <span className="flex flex-col items-end leading-tight">
              <span>
                {formatAUD(spentNum).replace("A$", "$")}
                <span className="text-muted-foreground"> / {formatAUD(capNum).replace("A$", "$")}</span>
              </span>
              <span className="block w-24 h-1 mt-0.5 rounded bg-muted overflow-hidden">
                <span
                  className={`block h-full ${overCap ? "bg-red-500" : "bg-indigo-500"}`}
                  style={{ width: `${Math.min(100, capNum > 0 ? (spentNum / capNum) * 100 : 0)}%` }}
                />
              </span>
            </span>
          ) : (
            formatAUD(totalAmount)
          )}
        </td>
        {showWeekly && (
          <td className={`pl-3 pr-0 py-2 text-right text-xs tabular-nums whitespace-nowrap w-px ${amountClass(totalWeekly)}`}>
            {totalWeekly === 0 ? "—" : `${formatAUD(totalWeekly).replace("A$", "$")}/wk`}
          </td>
        )}
        <td className="pl-1 pr-2 py-2 w-14 text-right whitespace-nowrap">
          <div className="inline-flex items-center gap-0.5">
            <ScheduledNotesPopover
              scheduledId={primary.id}
              notes={primary.notes}
              onSaved={() => {
                // Refresh the SWR-cached list so the icon reflects
                // the new value on this row (and stays in sync if
                // the user opens the popover again).
                void swrMutate("/api/scheduled");
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDelete({
                  ids: g.members.map((m) => m.id),
                  label:
                    g.members.length === 1
                      ? primary.payee || primary.description || "this entry"
                      : `${g.members.length} schedules in this group`,
                });
              }}
              className="lg:opacity-0 lg:group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-600"
              title="Delete group"
              aria-label="Delete scheduled group"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
      {/* Mobile-only second row: full payee on its own line, spanning all
          columns. Main row drops its bottom border on mobile (lg:border-b
          only) so the payee reads as part of the same row, and this
          mobile row carries the divider. Hidden on lg+ where the
          headlineLabel cell handles it inline. */}
      <tr
        className="lg:hidden border-b cursor-pointer hover:bg-muted/50"
        onClick={() => {
          if (isSelected) setSelectedId("");
          else setSelectedId(primary.id);
        }}
      >
        <td colSpan={100} className="px-2 pb-2 pt-0 text-sm font-medium break-words" title={headlineLabel}>
          {headlineLabel}
          {moreCount > 0 && (
            <span className="ml-2 text-xs text-muted-foreground">+{moreCount} more</span>
          )}
        </td>
      </tr>
      </Fragment>
    );
  }

  // Right-panel helpers — derived from the selected schedule. The form, the
  // lineage table, the forecast section and the "+ Add" button all live here
  // (below the chart) rather than inline under the clicked list row.
  const editing = selected ?? null;
  const selectedGroup = editing
    ? [...activeGroups, ...inactiveGroups].find((g) => g.lineageId === editing.lineageId) ?? null
    : null;
  const editingLatestMatchDate: string | null = (() => {
    if (!editing) return null;
    const seg = segmentResults.find((s) => s.schedule.id === editing.id);
    if (!seg) return null;
    let best: string | null = null;
    for (const t of txns) {
      if (!seg.matchedTxnIds.has(t.id)) continue;
      if (!best || t.date > best) best = t.date;
    }
    return best;
  })();

  return (
    <div className="space-y-3 lg:h-full lg:flex lg:flex-col lg:space-y-3">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:flex-1 lg:min-h-0">
      <div className="lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="space-y-4 lg:h-full lg:flex lg:flex-col lg:space-y-3">
        {/* Editor stack — sticky at the top of the left column on lg. Lineage
            table to pick a member, the compact form, and the upcoming forecast
            section. The schedule list below scrolls independently. */}
        {editing && selectedGroup && (
          <div className="rounded-lg border bg-muted/40 shadow-sm p-3 space-y-3 lg:shrink-0">
            <ScheduledEditForm
              key={editing.id}
              row={{
                id: editing.id,
                kind: editing.kind,
                payee: editing.payee,
                description: editing.description,
                amount: editing.amount,
                amountMin: editing.amountMin,
                type: editing.type,
                frequency: editing.frequency,
                interval: editing.interval,
                startDate: editing.startDate,
                endDate: editing.endDate,
                isActive: editing.isActive,
                dayOfMonth: editing.dayOfMonth,
                accountId: editing.accountId,
                categoryId: editing.categoryId,
                transferToAccountId: editing.transferToAccountId,
              }}
              allAccounts={accounts}
              allCategories={categories}
              canReplace={editing.isActive && editing.id === selectedGroup.activeMembers[0]?.id}
              latestMatchDate={editingLatestMatchDate}
              onAddToGroup={() => addToGroup(selectedGroup)}
              addingToGroup={addingTo === selectedGroup.lineageId}
              onSaved={() => {
                router.refresh();
                invalidateCashflow();
              }}
            />

            <div className="overflow-x-auto rounded-md border bg-background">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Start</th>
                    <th className="px-2 py-1 text-left font-medium">End</th>
                    <th className="px-2 py-1 text-left font-medium">Account</th>
                    <th className="px-2 py-1 text-left font-medium">Payee</th>
                    <th className="px-2 py-1 text-right font-medium">Amount</th>
                    <th className="px-2 py-1 text-right font-medium">Δ</th>
                    <th className="px-2 py-1 text-left font-medium">Status</th>
                    <th className="px-2 py-1 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedGroup.members.map((m, idx) => {
                    const isEditing = m.id === selectedId;
                    const status = m.isActive
                      ? "Active"
                      : isSuperseded(m)
                      ? "Superseded"
                      : "Inactive";
                    const statusClass = m.isActive
                      ? "text-emerald-600"
                      : isSuperseded(m)
                      ? "text-muted-foreground italic"
                      : "text-muted-foreground";
                    const myPayee = (m.payee ?? "").trim();
                    let previousMember: ScheduledRow | undefined;
                    for (let j = idx + 1; j < selectedGroup.members.length; j++) {
                      if ((selectedGroup.members[j].payee ?? "").trim() === myPayee) {
                        previousMember = selectedGroup.members[j];
                        break;
                      }
                    }
                    const delta = previousMember
                      ? Math.abs(parseFloat(m.amount)) - Math.abs(parseFloat(previousMember.amount))
                      : null;
                    const deltaText =
                      delta === null
                        ? "—"
                        : delta === 0
                        ? "—"
                        : `${delta > 0 ? "+" : "−"}${formatAUD(Math.abs(delta)).replace("A$", "$")}`;
                    const deltaClass =
                      delta === null || delta === 0
                        ? "text-muted-foreground"
                        : delta > 0
                        ? "text-rose-500"
                        : "text-emerald-600";
                    // Selected row gets a neutral muted background +
                    // a 2-px inset ring so the operator can see at a
                    // glance which member they're editing. The
                    // unselected rows are plain — no per-lineage tint,
                    // which used to fight every other coloured
                    // affordance in the editor stack.
                    return (
                      <tr
                        key={m.id}
                        onClick={() => setSelectedId(m.id)}
                        className={`cursor-pointer ${
                          isEditing
                            ? "font-medium bg-indigo-500/30 dark:bg-indigo-500/40 hover:bg-indigo-500/35 dark:hover:bg-indigo-500/45"
                            : "hover:bg-muted/40"
                        }`}
                      >
                        <td className="px-2 py-1 tabular-nums whitespace-nowrap">{formatDate(m.startDate)}</td>
                        <td className="px-2 py-1 tabular-nums whitespace-nowrap text-muted-foreground">
                          {m.endDate ? formatDate(m.endDate) : "—"}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {m.accountName ? (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
                              style={{ backgroundColor: dimColour(m.accountColor ?? "#94a3b8") }}
                            >
                              {m.accountName}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1 max-w-0">
                          <div className="truncate" title={m.payee ?? m.description ?? undefined}>
                            {m.payee || m.description || "—"}
                          </div>
                        </td>
                        <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${amountClass(m.amount)}`}>
                          {formatAUD(m.amount)}
                        </td>
                        <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${deltaClass}`}>
                          {deltaText}
                        </td>
                        <td className={`px-2 py-1 ${statusClass}`}>{status}</td>
                        <td className="px-1 py-1 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-0.5">
                            {selectedGroup.members.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMigrating(m);
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                title="Migrate this member out of the lineage as its own schedule"
                                aria-label="Migrate to a new lineage"
                              >
                                <GitBranch className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                // Per-row delete. Reuses the
                                // bulk-delete-aware confirmation
                                // dialog the list view already owns
                                // (setConfirmDelete → performDelete);
                                // when this member is the last in
                                // its lineage the dialog warns
                                // accordingly.
                                e.stopPropagation();
                                setConfirmDelete({
                                  ids: [m.id],
                                  label:
                                    m.payee ||
                                    m.description ||
                                    "this entry",
                                });
                              }}
                              className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-600"
                              title="Delete this schedule entry"
                              aria-label={`Delete schedule entry${m.payee ? ` for ${m.payee}` : ""}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <ScheduledForecastRows
              key={`fc-${editing.id}`}
              schedule={editing}
              initialForecasts={forecastList}
              onChanged={() => {
                router.refresh();
                invalidateCashflow();
              }}
            />
          </div>
        )}

        <div className="space-y-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
        <Card>
          <CardContent className="p-0">
            {activeGroups.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground text-sm">
                <p className="mb-4">No scheduled transactions yet.</p>
                <p className="text-xs">
                  Add recurring income or bills to project your future balance.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/30 text-xs text-muted-foreground border-b">
                  <tr>
                    <SortableTh column="next" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} className="pl-2 pr-2 w-px">
                      Next
                    </SortableTh>
                    <SortableTh column="frequency" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} className="px-0 w-px">
                      Frequency
                    </SortableTh>
                    <SortableTh column="payee" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} className="px-2 w-full">
                      Payee
                    </SortableTh>
                    <SortableTh column="amount" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} align="right" className="pl-2 pr-0 w-px">
                      Amount
                    </SortableTh>
                    {showWeekly && (
                      <SortableTh column="weekly" sortColumn={effectiveSortColumn} sortDir={sortDir} onClick={toggleSort} align="right" className="pl-3 pr-0 w-px">
                        Weekly
                      </SortableTh>
                    )}
                    <th className="pl-1 pr-2 py-2 w-8"></th>
                  </tr>
                </thead>
                <tbody>{sortGroups(activeGroups).map(renderGroup)}</tbody>
                {showWeekly && (() => {
                  const weeklyTotal = activeGroups
                    .flatMap((g) => g.activeMembers)
                    .reduce((s, m) => s + effectiveWeekly(m), 0);
                  return (
                    <tfoot className="border-t bg-muted/20 text-xs">
                      <tr>
                        <td colSpan={4} className="px-2 py-2 text-right text-muted-foreground font-medium">
                          Weekly total
                        </td>
                        <td className={`pl-3 pr-0 py-2 text-right font-semibold tabular-nums whitespace-nowrap ${amountClass(weeklyTotal)}`}>
                          {`${formatAUD(weeklyTotal).replace("A$", "$")}/wk`}
                        </td>
                        <td className="pl-1 pr-2 py-2 w-8" />
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            )}
          </CardContent>
        </Card>

        {inactiveGroups.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Inactive</h3>
            <Card>
              <CardContent className="p-0">
                <table className="w-full opacity-70">
                  <thead className="bg-muted/30 text-xs text-muted-foreground border-b">
                    <tr>
                      <SortableTh column="next" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} className="pl-2 pr-2 w-px">
                        Next
                      </SortableTh>
                      <SortableTh column="frequency" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} className="px-0 w-px">
                        Frequency
                      </SortableTh>
                      <SortableTh column="payee" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} className="px-2 w-full">
                        Payee
                      </SortableTh>
                      <SortableTh column="amount" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} align="right" className="pl-2 pr-0 w-px">
                        Amount
                      </SortableTh>
                      <SortableTh column="weekly" sortColumn={sortColumn} sortDir={sortDir} onClick={toggleSort} align="right" className="pl-3 pr-0 w-px">
                        Weekly
                      </SortableTh>
                      <th className="pl-1 pr-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>{sortGroups(inactiveGroups).map(renderGroup)}</tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        )}
        </div>
      </div>
      </div>

      <div className="lg:h-full lg:min-h-0 flex flex-col gap-2">
        <Card className="flex flex-col min-h-0 lg:flex-1 overflow-hidden">
          <CardHeader className="py-2 px-3 border-b shrink-0 flex flex-row items-center justify-between gap-2">
            <h3 className="text-base font-semibold truncate">
              {selected ? selected.payee || selected.description || "—" : "Select a scheduled entry"}
            </h3>
            <div className="flex items-center gap-2 shrink-0">
              {selected && (
                <div
                  role="radiogroup"
                  aria-label="Match window"
                  className="flex rounded-md border overflow-hidden text-[11px]"
                >
                  {MATCH_WINDOW_OPTIONS.map((opt) => {
                    const active = matchWindowMonths === opt.months;
                    return (
                      <button
                        key={opt.months}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setMatchWindowPersisted(opt.months)}
                        className={cn(
                          "px-2 py-0.5 transition-colors",
                          active
                            ? "bg-indigo-600 text-white font-medium"
                            : "bg-background text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {(() => {
              if (!selected) return null;
              const isDraft = parseFloat(selected.amount) === 0;
              const lineageSize = scheduled.filter((s) => s.lineageId === selected.lineageId).length;
              const canShowAll = !isDraft && lineageSize > 1;
              if (!canShowAll) return null;
              return (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                  <span>Show all</span>
                  <Switch
                    size="sm"
                    checked={showAll}
                    onCheckedChange={(v) => setShowAll(v)}
                    aria-label="Show all lineage members"
                  />
                </label>
              );
              })()}
            </div>
          </CardHeader>
          <CardContent className="!p-0 flex-1 min-h-0 flex flex-col">
            {!selected ? (
              <p className="text-sm text-muted-foreground text-center py-6 px-4">
                Pick a scheduled transaction on the left to see its matching transactions.
              </p>
            ) : txLoading ? (
              <p className="text-sm text-muted-foreground text-center py-6 px-4">Loading…</p>
            ) : (
              <>
                <div className="shrink-0 border-b px-4 pt-3 pb-2 space-y-2">
                  <div className="text-xs text-muted-foreground">
                    Showing matches in the last {matchWindowMonths} month{matchWindowMonths === 1 ? "" : "s"} · ±
                    {selected?.amountMin != null ? MATCH_TOLERANCE_DAYS_RANGE : MATCH_TOLERANCE_DAYS} day tolerance
                  </div>
                  <ScheduledOccurrencesChart
                    segments={chartSegments}
                    onBarClick={handleChartBarClick}
                    theme={
                      displayPrefs.chartScheduleTheme === FABULOUS_THEME_ID
                        ? "fabulous"
                        : "standard"
                    }
                    palette={
                      resolveSchedulePalette(
                        displayPrefs.chartScheduleTheme,
                        displayPrefs.chartSchedulePalettes,
                      ) ?? undefined
                    }
                  />
                </div>
                <div
                  ref={matchedListRef}
                  className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4"
                >
                  {matchedRows.length === 0 && unmatchedOccurrences.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      No expected occurrences in this window.
                    </p>
                  )}


                {isTransfer && transferPairRows.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Matched transfers
                    </p>
                    <ul className="divide-y text-sm">
                      {transferPairRows.map((row) => {
                        const sourceAcct = accountById.get(row.source.accountId);
                        const destAcct = row.dest ? accountById.get(row.dest.accountId) : undefined;
                        const bothMatched = !!row.source.txn && !!row.dest?.txn;
                        return (
                          <li
                            key={row.date}
                            className="grid grid-cols-[68px_1fr_24px_1fr] items-center gap-2 py-2 px-2 -mx-2 rounded"
                            style={
                              bothMatched
                                ? { boxShadow: `inset 3px 0 0 ${colourForFrequency(selected.frequency)}` }
                                : undefined
                            }
                          >
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {formatDate(row.date)}
                            </span>
                            {/* Source leg */}
                            <div className="min-w-0 flex items-center gap-2">
                              {sourceAcct && (
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0 ${
                                    row.source.txn ? "" : "opacity-50"
                                  }`}
                                  style={{ backgroundColor: dimColour(sourceAcct.color) }}
                                >
                                  {sourceAcct.name}
                                </span>
                              )}
                              <span
                                className={`shrink-0 font-medium tabular-nums ${amountClass(
                                  row.source.txn ? row.source.txn.amount : row.source.expectedAmount,
                                )} ${row.source.txn ? "" : "italic opacity-60"}`}
                              >
                                {formatAUD(
                                  row.source.txn ? row.source.txn.amount : row.source.expectedAmount,
                                )}
                              </span>
                              {!row.source.txn && (
                                <span className="text-[10px] text-amber-600 shrink-0">missed</span>
                              )}
                            </div>
                            <span className="text-xl leading-none font-bold text-muted-foreground text-center">
                              →
                            </span>
                            {/* Destination leg */}
                            <div className="min-w-0 flex items-center gap-2">
                              {destAcct ? (
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0 ${
                                    row.dest?.txn ? "" : "opacity-50"
                                  }`}
                                  style={{ backgroundColor: dimColour(destAcct.color) }}
                                >
                                  {destAcct.name}
                                </span>
                              ) : null}
                              {row.dest && (
                                <>
                                  <span
                                    className={`shrink-0 font-medium tabular-nums ${amountClass(
                                      row.dest.txn ? row.dest.txn.amount : row.dest.expectedAmount,
                                    )} ${row.dest.txn ? "" : "italic opacity-60"}`}
                                  >
                                    {formatAUD(
                                      row.dest.txn ? row.dest.txn.amount : row.dest.expectedAmount,
                                    )}
                                  </span>
                                  {!row.dest.txn && (
                                    <span className="text-[10px] text-amber-600 shrink-0">missed</span>
                                  )}
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {!isTransfer && selected.categoryId && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      {selected.categoryName ?? "Category"} transactions
                    </p>
                    {catLoading ? (
                      <p className="text-xs text-muted-foreground py-2">Loading…</p>
                    ) : categoryListRows.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">No transactions in this category.</p>
                    ) : (
                      <ul className="divide-y text-sm">
                        {(() => {
                          // Budget periods array, used both for the row-colour
                          // rank and to map a row's `periodIndex` back to the
                          // bar's date for chart-click scrolling.
                          const isBudgetSelected = selected?.kind === "budget";
                          const budgetPeriodsList = isBudgetSelected
                            ? pastBudgetPeriods(
                                selected!.startDate,
                                selected!.frequency,
                                new Date(),
                                fromISO,
                              )
                            : [];
                          // Pre-compute per-group totals so the subtotal row
                          // at each group boundary can render sum + average +
                          // count without re-walking the list.
                          const keyOf = (r: CategoryListRow) =>
                            r.kind === "missed"
                              ? `missed#${r.segmentId}`
                              : isBudgetSelected
                              ? `period#${r.periodIndex ?? "none"}`
                              : `seg#${r.segmentId ?? "none"}`;
                          return categoryListRows.flatMap((row, i) => {
                          // Group key changes between adjacent rows insert a
                          // breathing-room gap so distinct lineage segments
                          // (or budget periods) read as separate clusters
                          // even without a divider — for budgets the group
                          // is the period; for non-budget rows it's the
                          // lineage segment that claimed the row (or
                          // "missed" for unmatched). The gap (~28 px)
                          // replaces a per-group subtotal row that used to
                          // sit here.
                          const groupKey = keyOf(row);
                          const prevRow = i > 0 ? categoryListRows[i - 1] : null;
                          const prevKey = prevRow ? keyOf(prevRow) : null;
                          const groupBreakCls =
                            prevKey !== null && prevKey !== groupKey ? "mt-7" : "";
                          if (row.kind === "missed") {
                            const acct = accountById.get(row.accountId);
                            const items: React.ReactNode[] = [
                              <li
                                key={`missed#${row.date}#${row.segmentId}`}
                                data-bar-date={row.date}
                                className={`flex justify-between items-center py-2 px-2 -mx-2 gap-3 rounded ${groupBreakCls}`}
                                style={{
                                  boxShadow: `inset 3px 0 0 ${MISSED_ROW_COLOUR}`,
                                }}
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap w-[88px]">
                                    {formatDate(row.date)}
                                  </span>
                                  {acct && (
                                    <span
                                      className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0 opacity-70"
                                      style={{ backgroundColor: dimColour(acct.color) }}
                                    >
                                      {acct.name}
                                    </span>
                                  )}
                                  <span className="truncate text-muted-foreground italic">expected, no match</span>
                                </div>
                                <span className={`shrink-0 font-medium tabular-nums opacity-70 ${amountClass(row.amount)}`}>
                                  {formatAUD(row.amount)}
                                </span>
                              </li>,
                            ];
                            return items;
                          }
                          const t = row.txn;
                          const acct = accountById.get(t.accountId);
                          const occ = matchedReals.get(t.id);
                          const drift = occ ? diffDaysISO(t.date, occ.occurrenceDate) : 0;
                          const amt = parseFloat(t.amount);
                          const segment = row.segmentId ? chartSegments.find((s) => s.id === row.segmentId) : null;
                          // Budgets aggregate across the whole period; a per-
                          // transaction "under max" delta is meaningless, so
                          // suppress it on budget rows.
                          const gap =
                            segment && selected?.kind !== "budget"
                              ? rangeGap(amt, segment)
                              : null;
                          const isBudgetRow =
                            selected?.kind === "budget" && row.periodIndex != null;
                          // For chart-bar click navigation: budget rows scroll
                          // to their period's start date (matching the bar's
                          // `date`); non-budget rows scroll to the txn date.
                          const barDate = isBudgetRow && row.periodIndex != null
                            ? budgetPeriodsList[row.periodIndex]?.from ?? t.date
                            : t.date;
                          const items: React.ReactNode[] = [];
                          items.push(
                            <li
                              key={t.id}
                              data-bar-date={barDate}
                              className={`py-2 px-2 -mx-2 rounded ${groupBreakCls}`}
                            >
                              <div className="flex justify-between items-center gap-3">
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap w-[88px]">
                                    {formatDate(t.date)}
                                  </span>
                                  {acct && (
                                    <span
                                      className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
                                      style={{ backgroundColor: dimColour(acct.color) }}
                                    >
                                      {acct.name}
                                    </span>
                                  )}
                                  {/* Desktop only — on mobile the full payee
                                      sits in the lg:hidden block below this
                                      flex row. */}
                                  <span className={`hidden lg:inline truncate ${segment ? "" : "text-muted-foreground"}`}>
                                    {t.payee || t.description || "—"}
                                  </span>
                                  {drift !== 0 && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      ({drift > 0 ? "+" : ""}{drift}d)
                                    </span>
                                  )}
                                  {!segment && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">unmatched</span>
                                  )}
                                </div>
                                <span className="shrink-0 flex items-baseline gap-3">
                                  <span
                                    className="text-[10px] tabular-nums text-muted-foreground w-16 text-right"
                                    title={
                                      gap
                                        ? `Under max by ${formatAUD(gap).replace("A$", "$")}`
                                        : undefined
                                    }
                                  >
                                    {gap ? `−${formatAUD(gap).replace("A$", "$")}` : ""}
                                  </span>
                                  <span className={`font-medium tabular-nums ${amountClass(amt)}`}>
                                    {formatAUD(amt)}
                                  </span>
                                </span>
                              </div>
                              {/* Mobile-only second line: full payee, full
                                  width below the meta row above. As a sibling
                                  block of the flex container (not a flex
                                  child) the desktop layout above stays
                                  exactly as it was. */}
                              <div className={`lg:hidden mt-0.5 break-words font-medium ${segment ? "" : "text-muted-foreground"}`}>
                                {t.payee || t.description || "—"}
                              </div>
                            </li>,
                          );
                          return items;
                          });
                        })()}
                      </ul>
                    )}
                  </div>
                )}

                {!isTransfer && !selected.categoryId && (matchedRows.length > 0 || unmatchedOccurrences.length > 0) && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Transactions
                    </p>
                    <ul className="divide-y text-sm">
                      {/* Build unified rows: matched txns + missed occurrences, sorted newest-first.
                          When the selected schedule is one of multiple lineage members, scope to it. */}
                      {(() => {
                        const isDraft = parseFloat(selected.amount) === 0;
                        const lineageSize = scheduled.filter((s) => s.lineageId === selected.lineageId).length;
                        const shouldScope = !isDraft && lineageSize > 1 && !showAll;
                        const matchedFiltered = shouldScope
                          ? matchedRows.filter((t) => matchedReals.get(t.id)?.segmentId === selected.id)
                          : matchedRows;
                        const missedFiltered = shouldScope
                          ? unmatchedOccurrences.filter((o) => o.segmentId === selected.id)
                          : unmatchedOccurrences;
                        return [
                          ...matchedFiltered.map((t) => ({
                            kind: "txn" as const,
                            date: t.date,
                            txn: t,
                          })),
                          ...missedFiltered.map((o) => ({
                            kind: "missed" as const,
                            date: o.date,
                            accountId: o.accountId,
                            amount: o.amount,
                          })),
                        ]
                        .sort((a, b) => (a.date < b.date ? 1 : -1))
                        .map((row, i) => {
                          if (row.kind === "missed") {
                            const acct = accountById.get(row.accountId);
                            return (
                              <li
                                key={`missed#${row.date}#${i}`}
                                className="flex justify-between items-center py-2 px-2 -mx-2 gap-3 rounded"
                                style={{
                                  backgroundColor: `${MISSED_ROW_COLOUR}40`,
                                  boxShadow: `inset 3px 0 0 ${MISSED_ROW_COLOUR}`,
                                }}
                              >
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap w-[88px]">
                                    {formatDate(row.date)}
                                  </span>
                                  {acct && (
                                    <span
                                      className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0 opacity-70"
                                      style={{ backgroundColor: dimColour(acct.color) }}
                                    >
                                      {acct.name}
                                    </span>
                                  )}
                                  <span className="truncate text-muted-foreground italic">expected, no match</span>
                                </div>
                                <span className={`shrink-0 font-medium tabular-nums opacity-70 ${amountClass(row.amount)}`}>
                                  {formatAUD(row.amount)}
                                </span>
                              </li>
                            );
                          }
                          const t = row.txn;
                          const acct = accountById.get(t.accountId);
                          const occ = matchedReals.get(t.id)!;
                          const drift = diffDaysISO(t.date, occ.occurrenceDate);
                          const amt = parseFloat(t.amount);
                          const segment = chartSegments.find((s) => s.id === occ.segmentId);
                          const gap = segment ? rangeGap(amt, segment) : null;
                          return (
                            <li
                              key={t.id}
                              className="py-2 px-2 -mx-2 rounded"
                              style={
                                segment
                                  ? {
                                      backgroundColor: `${segment.color}1f`,
                                      boxShadow: `inset 3px 0 0 ${segment.color}`,
                                    }
                                  : undefined
                              }
                            >
                              <div className="flex justify-between items-center gap-3">
                                <div className="min-w-0 flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground tabular-nums shrink-0 whitespace-nowrap w-[88px]">
                                    {formatDate(t.date)}
                                  </span>
                                  {acct && (
                                    <span
                                      className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
                                      style={{ backgroundColor: dimColour(acct.color) }}
                                    >
                                      {acct.name}
                                    </span>
                                  )}
                                  {/* Desktop only — full payee in the
                                      lg:hidden block below the flex row. */}
                                  <span className="hidden lg:inline truncate">
                                    {t.payee || t.description || "—"}
                                  </span>
                                  {drift !== 0 && (
                                    <span className="text-[10px] text-muted-foreground shrink-0">
                                      ({drift > 0 ? "+" : ""}{drift}d)
                                    </span>
                                  )}
                                </div>
                                <span className="shrink-0 flex items-baseline gap-3">
                                  <span
                                    className="text-[10px] tabular-nums text-muted-foreground w-16 text-right"
                                    title={
                                      gap
                                        ? `Under max by ${formatAUD(gap).replace("A$", "$")}`
                                        : undefined
                                    }
                                  >
                                    {gap ? `−${formatAUD(gap).replace("A$", "$")}` : ""}
                                  </span>
                                  <span className={`font-medium tabular-nums ${amountClass(amt)}`}>
                                    {formatAUD(amt)}
                                  </span>
                                </span>
                              </div>
                              <div className="lg:hidden mt-0.5 break-words font-medium">
                                {t.payee || t.description || "—"}
                              </div>
                            </li>
                          );
                        });
                      })()}
                    </ul>
                  </div>
                )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
      </div>

      <NewScheduledDialog
        open={migrating !== null}
        onOpenChange={(o) => !o && setMigrating(null)}
        title="Migrate schedule to a new lineage"
        initialRow={migrating ? toFormRow(migrating) : undefined}
        onCreated={async () => {
          if (!migrating) return;
          const res = await fetch(`/api/scheduled/${migrating.id}`, { method: "DELETE" });
          if (!res.ok) {
            toast.error("Created new schedule, but failed to delete the old one");
          }
        }}
      />

      <Dialog open={confirmDelete !== null} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete scheduled?</DialogTitle>
          </DialogHeader>
          {confirmDelete && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                This will permanently delete {confirmDelete.label}. Past matched
                transactions stay; future projections will stop.
              </p>
              <div className="flex gap-2 pt-1">
                <Button
                  variant="destructive"
                  onClick={() => performDelete(confirmDelete.ids)}
                  disabled={deleting}
                  className="flex-1"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
