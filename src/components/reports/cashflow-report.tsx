"use client";

import { Fragment, createContext, useContext, useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { format, parseISO, endOfMonth } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { CashflowReport as CashflowData, CashflowCategory } from "@/app/api/reports/cashflow/route";
import { CashflowCellDialog, type CashflowCellQuery } from "./cashflow-cell-dialog";

const CellOpenerContext = createContext<((q: CashflowCellQuery) => void) | null>(null);
const useCellOpener = () => useContext(CellOpenerContext);

function monthRange(m: string): { from: string; to: string; label: string } {
  const start = `${m}-01`;
  const startDate = parseISO(start);
  return {
    from: start,
    to: format(endOfMonth(startDate), "yyyy-MM-dd"),
    label: format(startDate, "MMM ''yy"),
  };
}

function totalRangeLabel(from: string, to: string): string {
  const a = format(parseISO(from), "MMM ''yy");
  const b = format(parseISO(to), "MMM ''yy");
  return a === b ? a : `${a} – ${b}`;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const numFmt = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 });

type CellResult = { text: string; className: string };

function formatAmount(n: number | undefined, mode: "plain" | "net" | "balance" = "plain"): CellResult {
  if (n === undefined || n === 0) return { text: "—", className: "text-muted-foreground" };
  if (n < 0) return { text: `(${numFmt.format(Math.abs(n))})`, className: mode === "plain" ? "text-foreground" : "text-red-500" };
  return { text: numFmt.format(n), className: mode === "net" ? "text-emerald-600" : "text-foreground" };
}

function AmountCell({
  value,
  colHighlight,
  mode = "plain",
  negate,
  muted,
  overPlan,
  borderLeft,
  onClick,
}: {
  value: number | undefined;
  colHighlight?: boolean;
  mode?: "plain" | "net" | "balance";
  negate?: boolean;
  muted?: boolean;
  /** Renders the value in red — used when actual spend exceeds the plan
   * for that cell. */
  overPlan?: boolean;
  /** Adds a left border so adjacent month groups read as visually distinct. */
  borderLeft?: boolean;
  /** When set and the value is non-zero, the rendered amount becomes a
   * button that opens the cell-drilldown dialog. */
  onClick?: () => void;
}) {
  const display = negate && value !== undefined ? -value : value;
  const { text, className } = formatAmount(display, mode);
  const colour = overPlan
    ? "text-red-500 font-medium"
    : muted
      ? "text-muted-foreground"
      : className;
  const isClickable = onClick && value !== undefined && value !== 0;
  return (
    <td className={`px-3 py-1.5 text-right tabular-nums ${colHighlight ? "bg-indigo-500/10" : ""} ${borderLeft ? "border-l border-border" : ""} ${colour}`}>
      {isClickable ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="hover:underline hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded -mx-0.5 px-0.5 transition-colors"
        >
          {text}
        </button>
      ) : (
        text
      )}
    </td>
  );
}

/** True when the row is an expense-style row (negate=true) with a non-zero
 * plan and the actual magnitude exceeds it. Income/uncategorised rows
 * (negate=false) are excluded since "over plan" doesn't read as bad there. */
function isOverPlan(actual: number | undefined, plan: number | undefined, negate: boolean): boolean {
  if (!negate) return false;
  if (plan == null || plan <= 0) return false;
  if (actual == null) return false;
  return Math.abs(actual) > plan;
}

/** Compact secondary cell rendered next to a month's actual when the
 * Plan toggle is enabled. Muted styling so the actual stays the dominant
 * value at a glance. */
function MonthSubCell({
  value,
  colHighlight,
  borderLeft,
}: {
  value: number | undefined;
  colHighlight?: boolean;
  borderLeft?: boolean;
}) {
  const { text } = formatAmount(value && value > 0 ? value : undefined, "plain");
  return (
    <td
      className={`px-2 py-1.5 text-right tabular-nums text-[11px] text-muted-foreground/70 whitespace-nowrap ${
        colHighlight ? "bg-indigo-500/10" : ""
      } ${borderLeft ? "border-l border-border" : ""}`}
    >
      {text}
    </td>
  );
}

/** Sum of budget + scheduled for a month, returning undefined when neither
 * is set — they don't overlap on a single category, so the sum reads as
 * "whichever applies". */
function planAt(
  budgetByMonth: Record<string, number> | undefined,
  scheduledByMonth: Record<string, number> | undefined,
  m: string,
): number | undefined {
  const v = (budgetByMonth?.[m] ?? 0) + (scheduledByMonth?.[m] ?? 0);
  return v > 0 ? v : undefined;
}

function CountCell({ value, colHighlight }: { value: number | undefined; colHighlight?: boolean }) {
  return (
    <td className={`px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground ${colHighlight ? "bg-indigo-500/10" : ""}`}>
      {value ? value : "—"}
    </td>
  );
}

function BudgetCell({ value }: { value?: number }) {
  const { text } = formatAmount(value ? value : undefined, "plain");
  return (
    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground/70">{text}</td>
  );
}

function SectionHeader({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <td
        colSpan={cols}
        className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 sticky left-0"
      >
        {label}
      </td>
    </tr>
  );
}

// Aggregate byMonth values from multiple categories
function aggregateByMonth(cats: CashflowCategory[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of cats) {
    for (const [m, v] of Object.entries(cat.byMonth)) {
      out[m] = (out[m] ?? 0) + v;
    }
  }
  return out;
}

function aggregateCountByMonth(cats: CashflowCategory[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of cats) {
    for (const [m, v] of Object.entries(cat.countByMonth)) {
      out[m] = (out[m] ?? 0) + v;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// 3-level hierarchy:
//   GrandparentGroup  (grandparent cats, aggregate header)
//     ParentSubGroup  (parent cats, sub-header, may have own transactions)
//       CashflowCategory  (leaf/grandchild cats)
//   StandaloneGroup   (cats with no parent and no children, or depth-1 with no children)
// ──────────────────────────────────────────────────────────────────────────

interface ParentSubGroup {
  parentId: string;
  parentName: string;
  parentCat?: CashflowCategory; // defined when parent itself has direct transactions
  byMonth: Record<string, number>;
  countByMonth: Record<string, number>;
  total: number;
  totalCount: number;
  budgetPerMonth: number;
  scheduledPerMonth: number;
  budgetByMonth: Record<string, number>;
  scheduledByMonth: Record<string, number>;
  children: CashflowCategory[]; // grandchildren (depth-2)
}

interface GrandparentGroup {
  kind: "grandparent";
  grandparentId: string;
  grandparentName: string;
  hasDirect: boolean; // true when the grandparent category itself has direct transactions
  byMonth: Record<string, number>;
  countByMonth: Record<string, number>;
  total: number;
  totalCount: number;
  budgetPerMonth: number;
  scheduledPerMonth: number;
  budgetByMonth: Record<string, number>;
  scheduledByMonth: Record<string, number>;
  subGroups: ParentSubGroup[];
}

interface StandaloneGroup { kind: "standalone"; cat: CashflowCategory }

type DisplayGroup = GrandparentGroup | StandaloneGroup;

function sumBudget(cats: CashflowCategory[]): number { return cats.reduce((s, c) => s + c.budgetPerMonth, 0); }
function sumScheduled(cats: CashflowCategory[]): number { return cats.reduce((s, c) => s + c.scheduledPerMonth, 0); }
function aggregateBudgetByMonth(cats: CashflowCategory[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cats) {
    for (const [m, v] of Object.entries(c.budgetByMonth ?? {})) {
      out[m] = (out[m] ?? 0) + v;
    }
  }
  return out;
}
function aggregateScheduledByMonth(cats: CashflowCategory[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cats) {
    for (const [m, v] of Object.entries(c.scheduledByMonth ?? {})) {
      out[m] = (out[m] ?? 0) + v;
    }
  }
  return out;
}

function buildGroups(cats: CashflowCategory[]): DisplayGroup[] {
  const depth0 = cats.filter((c) => !c.parentId);
  const depth1 = cats.filter((c) => c.parentId && !c.grandparentId);
  const depth2 = cats.filter((c) => c.grandparentId);

  const grandchildrenByParentId = new Map<string, CashflowCategory[]>();
  for (const c of depth2) {
    const arr = grandchildrenByParentId.get(c.parentId!) ?? [];
    arr.push(c);
    grandchildrenByParentId.set(c.parentId!, arr);
  }

  const depth1ById = new Map(depth1.map((c) => [c.id, c]));
  const depth0ById = new Map(depth0.map((c) => [c.id, c]));

  // Track every depth-1 cat that gets placed under a parent group so it is never
  // also rendered as standalone (was the double-render bug).
  const handledDepth1Ids = new Set<string>();

  // ── 3-level grandparent groups (depth2 present) ──────────────────────────

  const grandparentIds = new Set<string>();
  for (const c of depth1) {
    if (grandchildrenByParentId.has(c.id)) grandparentIds.add(c.parentId!);
  }
  for (const c of depth2) {
    if (c.grandparentId) grandparentIds.add(c.grandparentId);
  }

  const grandparentGroups = new Map<string, GrandparentGroup>();

  for (const gpId of grandparentIds) {
    const gpCat = depth0ById.get(gpId);
    const grandparentName = gpCat?.name ?? depth2.find((c) => c.grandparentId === gpId)?.grandparentName ?? "Unknown";
    const parentSubs: ParentSubGroup[] = [];

    const depth1Children = depth1.filter((c) => c.parentId === gpId && grandchildrenByParentId.has(c.id));
    for (const p1 of depth1Children) {
      handledDepth1Ids.add(p1.id);
      const grandkids = (grandchildrenByParentId.get(p1.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      const allInSub = depth1ById.has(p1.id) ? [p1, ...grandkids] : grandkids;
      const byMonth = aggregateByMonth(allInSub);
      const countByMonth = aggregateCountByMonth(allInSub);
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
      const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
      parentSubs.push({ parentId: p1.id, parentName: p1.name, parentCat: p1, byMonth, countByMonth, total, totalCount, budgetPerMonth: sumBudget(allInSub), scheduledPerMonth: sumScheduled(allInSub), budgetByMonth: aggregateBudgetByMonth(allInSub), scheduledByMonth: aggregateScheduledByMonth(allInSub), children: grandkids });
    }

    // depth-2 cats whose depth-1 parent has no own transactions
    const depth2UnderGp = depth2.filter((c) => c.grandparentId === gpId);
    const coveredParentIds = new Set(depth1Children.map((c) => c.id));
    for (const c of depth2UnderGp) {
      if (!coveredParentIds.has(c.parentId!)) {
        coveredParentIds.add(c.parentId!);
        const siblings = depth2UnderGp.filter((x) => x.parentId === c.parentId).sort((a, b) => a.name.localeCompare(b.name));
        const byMonth = aggregateByMonth(siblings);
        const countByMonth = aggregateCountByMonth(siblings);
        const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
        const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
        parentSubs.push({ parentId: c.parentId!, parentName: c.parentName ?? "Unknown", byMonth, countByMonth, total, totalCount, budgetPerMonth: sumBudget(siblings), scheduledPerMonth: sumScheduled(siblings), budgetByMonth: aggregateBudgetByMonth(siblings), scheduledByMonth: aggregateScheduledByMonth(siblings), children: siblings });
      }
    }

    parentSubs.sort((a, b) => a.parentName.localeCompare(b.parentName));

    const gpOwnCat = depth0ById.get(gpId);
    const allForGp: CashflowCategory[] = gpOwnCat ? [gpOwnCat] : [];
    for (const sub of parentSubs) allForGp.push(...sub.children, ...(sub.parentCat ? [sub.parentCat] : []));
    const gpByMonth = aggregateByMonth(allForGp);
    const gpCountByMonth = aggregateCountByMonth(allForGp);
    const gpTotal = Object.values(gpByMonth).reduce((s, v) => s + v, 0);
    const gpTotalCount = Object.values(gpCountByMonth).reduce((s, v) => s + v, 0);

    grandparentGroups.set(gpId, { kind: "grandparent", grandparentId: gpId, grandparentName, hasDirect: gpOwnCat !== undefined, byMonth: gpByMonth, countByMonth: gpCountByMonth, total: gpTotal, totalCount: gpTotalCount, budgetPerMonth: sumBudget(allForGp), scheduledPerMonth: sumScheduled(allForGp), budgetByMonth: aggregateBudgetByMonth(allForGp), scheduledByMonth: aggregateScheduledByMonth(allForGp), subGroups: parentSubs });
  }

  const depth0IdsAsGrandparents = new Set(grandparentGroups.keys());

  const depth1ByParentId = new Map<string, CashflowCategory[]>();
  for (const c of depth1) {
    const arr = depth1ByParentId.get(c.parentId!) ?? [];
    arr.push(c);
    depth1ByParentId.set(c.parentId!, arr);
  }

  const groups: DisplayGroup[] = [...grandparentGroups.values()];

  // ── 2-level parent groups (depth0 cat that has depth-1 children) ──────────

  for (const cat of depth0) {
    if (depth0IdsAsGrandparents.has(cat.id)) continue;
    const kids = (depth1ByParentId.get(cat.id) ?? []).filter((k) => !handledDepth1Ids.has(k.id));
    if (kids.length === 0) {
      groups.push({ kind: "standalone", cat });
    } else {
      const subGroups: ParentSubGroup[] = kids
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((k) => {
          handledDepth1Ids.add(k.id);
          const byMonth = aggregateByMonth([k]);
          const countByMonth = aggregateCountByMonth([k]);
          const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
          const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
          return { parentId: k.id, parentName: k.name, parentCat: k, byMonth, countByMonth, total, totalCount, budgetPerMonth: k.budgetPerMonth, scheduledPerMonth: k.scheduledPerMonth, budgetByMonth: { ...k.budgetByMonth }, scheduledByMonth: { ...k.scheduledByMonth }, children: [] };
        });
      const allForGp: CashflowCategory[] = [cat, ...subGroups.flatMap((s) => s.parentCat ? [s.parentCat] : [])];
      const gpByMonth = aggregateByMonth(allForGp);
      const gpCountByMonth = aggregateCountByMonth(allForGp);
      const gpTotal = Object.values(gpByMonth).reduce((s, v) => s + v, 0);
      const gpTotalCount = Object.values(gpCountByMonth).reduce((s, v) => s + v, 0);
      groups.push({ kind: "grandparent", grandparentId: cat.id, grandparentName: cat.name, hasDirect: true, byMonth: gpByMonth, countByMonth: gpCountByMonth, total: gpTotal, totalCount: gpTotalCount, budgetPerMonth: sumBudget(allForGp), scheduledPerMonth: sumScheduled(allForGp), budgetByMonth: aggregateBudgetByMonth(allForGp), scheduledByMonth: aggregateScheduledByMonth(allForGp), subGroups });
    }
  }

  // ── Remaining depth-1 cats: parent has no transactions in this period ─────
  // Group by parentId to create a synthetic parent header row.

  const unhandledByParent = new Map<string, CashflowCategory[]>();
  for (const cat of depth1) {
    if (handledDepth1Ids.has(cat.id)) continue;
    if (!cat.parentId) { groups.push({ kind: "standalone", cat }); continue; }
    const arr = unhandledByParent.get(cat.parentId) ?? [];
    arr.push(cat);
    unhandledByParent.set(cat.parentId, arr);
  }

  for (const [parentId, kids] of unhandledByParent) {
    const parentName = kids[0].parentName ?? "Unknown";
    const sorted = kids.sort((a, b) => a.name.localeCompare(b.name));
    const newSubGroups: ParentSubGroup[] = sorted.map((k) => {
      const byMonth = aggregateByMonth([k]);
      const countByMonth = aggregateCountByMonth([k]);
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
      const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
      return { parentId: k.id, parentName: k.name, parentCat: k, byMonth, countByMonth, total, totalCount, budgetPerMonth: k.budgetPerMonth, scheduledPerMonth: k.scheduledPerMonth, budgetByMonth: { ...k.budgetByMonth }, scheduledByMonth: { ...k.scheduledByMonth }, children: [] };
    });

    const existing = grandparentGroups.get(parentId);
    if (existing) {
      for (const sg of newSubGroups) existing.subGroups.push(sg);
      existing.subGroups.sort((a, b) => a.parentName.localeCompare(b.parentName));
      const gpOwnCat = depth0ById.get(parentId);
      const allForGp: CashflowCategory[] = gpOwnCat ? [gpOwnCat] : [];
      for (const sub of existing.subGroups) {
        allForGp.push(...sub.children, ...(sub.parentCat ? [sub.parentCat] : []));
      }
      existing.byMonth = aggregateByMonth(allForGp);
      existing.countByMonth = aggregateCountByMonth(allForGp);
      existing.total = Object.values(existing.byMonth).reduce((s, v) => s + v, 0);
      existing.totalCount = Object.values(existing.countByMonth).reduce((s, v) => s + v, 0);
      existing.budgetPerMonth = sumBudget(allForGp);
      existing.scheduledPerMonth = sumScheduled(allForGp);
      existing.budgetByMonth = aggregateBudgetByMonth(allForGp);
      existing.scheduledByMonth = aggregateScheduledByMonth(allForGp);
    } else {
      const gpByMonth = aggregateByMonth(sorted);
      const gpCountByMonth = aggregateCountByMonth(sorted);
      const gpTotal = Object.values(gpByMonth).reduce((s, v) => s + v, 0);
      const gpTotalCount = Object.values(gpCountByMonth).reduce((s, v) => s + v, 0);
      groups.push({ kind: "grandparent", grandparentId: parentId, grandparentName: parentName, hasDirect: false, byMonth: gpByMonth, countByMonth: gpCountByMonth, total: gpTotal, totalCount: gpTotalCount, budgetPerMonth: sumBudget(sorted), scheduledPerMonth: sumScheduled(sorted), budgetByMonth: aggregateBudgetByMonth(sorted), scheduledByMonth: aggregateScheduledByMonth(sorted), subGroups: newSubGroups });
    }
  }

  groups.sort((a, b) => {
    const nameA = a.kind === "standalone" ? a.cat.name : a.grandparentName;
    const nameB = b.kind === "standalone" ? b.cat.name : b.grandparentName;
    return nameA.localeCompare(nameB);
  });

  return groups;
}

function ParentHeaderRow({
  name, months, byMonth, countByMonth, total, totalCount, thisMonth,
  negate, href, grandparent, hasDirect, showValues = true, opts,
  budgetPerMonth, scheduledPerMonth, budgetByMonth, scheduledByMonth,
  isCollapsed, onToggle, categoryIdForCell, fromForCell, toForCell,
}: {
  name: string;
  months: string[];
  byMonth: Record<string, number>;
  countByMonth: Record<string, number>;
  total: number;
  totalCount: number;
  thisMonth: string;
  negate?: boolean;
  href?: string;
  grandparent?: boolean;
  hasDirect?: boolean;
  showValues?: boolean;
  opts: ColOpts;
  budgetPerMonth?: number;
  scheduledPerMonth?: number;
  budgetByMonth?: Record<string, number>;
  scheduledByMonth?: Record<string, number>;
  isCollapsed?: boolean;
  onToggle?: () => void;
  /** When set, value cells become drill-throughs that include descendant
   * categories. Skipped on synthetic rows that don't map to a real id. */
  categoryIdForCell?: string;
  fromForCell?: string;
  toForCell?: string;
}) {
  const display = (v: number | undefined) => (negate && v !== undefined ? -v : v);
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
  const nameColor = hasDirect ? "text-rose-500/70" : "text-muted-foreground";
  const open = useCellOpener();
  const openMonth = open && categoryIdForCell
    ? (m: string) => {
        const r = monthRange(m);
        open({
          categoryId: categoryIdForCell,
          includeChildren: true,
          from: r.from,
          to: r.to,
          rangeLabel: r.label,
          displayName: name,
        });
      }
    : undefined;
  const openTotal = open && categoryIdForCell && fromForCell && toForCell
    ? () =>
        open({
          categoryId: categoryIdForCell,
          includeChildren: true,
          from: fromForCell,
          to: toForCell,
          rangeLabel: totalRangeLabel(fromForCell, toForCell),
          displayName: name,
        })
    : undefined;
  return (
    <tr
      className={`border-b ${grandparent ? "border-border bg-muted/30" : "border-border/50"} ${onToggle ? "cursor-pointer" : ""}`}
      onClick={onToggle}
    >
      <td className={`px-3 py-1.5 text-sm sticky left-0 whitespace-nowrap ${grandparent ? `font-semibold bg-muted/30 ${nameColor}` : `font-medium bg-background ${nameColor}`}`}>
        <span className="flex items-center gap-1">
          {onToggle && <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {href ? (
            <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-indigo-600 transition-colors">
              {name}
            </Link>
          ) : name}
        </span>
      </td>
      {months.map((m) => {
        const plan = showValues ? planAt(budgetByMonth, scheduledByMonth, m) : undefined;
        const actual = showValues ? byMonth[m] : undefined;
        const over = isOverPlan(actual, plan, !!negate);
        return (
          <Fragment key={m}>
            {opts.showPlan && (
              <MonthSubCell value={plan} colHighlight={m === thisMonth} borderLeft />
            )}
            <AmountCell
              value={showValues ? display(byMonth[m]) : undefined}
              colHighlight={m === thisMonth}
              muted={!over}
              overPlan={over}
              borderLeft={!opts.showPlan}
              onClick={showValues && openMonth ? () => openMonth(m) : undefined}
            />
            {opts.showCounts && <td className={m === thisMonth ? "bg-indigo-500/10" : ""} />}
          </Fragment>
        );
      })}
      {opts.showTotal && (
        <AmountCell
          value={showValues ? display(total) : undefined}
          muted
          onClick={showValues ? openTotal : undefined}
        />
      )}
      {opts.showTotal && opts.showCounts && <td />}
      {opts.showAvg && <AmountCell value={showValues && months.length > 0 ? display(total / months.length) : undefined} muted />}
      {opts.showPlan && (
        <BudgetCell value={(budgetPerMonth ?? 0) + (scheduledPerMonth ?? 0)} />
      )}
    </tr>
  );
}

function SubParentHeaderRow({
  sub, months, thisMonth, negate, from, to,
  showValues = true, opts, isCollapsed, onToggle,
}: {
  sub: ParentSubGroup;
  months: string[];
  thisMonth: string;
  negate?: boolean;
  from: string;
  to: string;
  showValues?: boolean;
  opts: ColOpts;
  isCollapsed?: boolean;
  onToggle?: () => void;
}) {
  const display = (v: number | undefined) => (negate && v !== undefined ? -v : v);
  const href = sub.parentCat ? `/transactions?categoryId=${sub.parentCat.id}&from=${from}&to=${to}` : undefined;
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
  const nameColor = sub.parentCat ? "text-rose-500/70" : "text-muted-foreground";
  const open = useCellOpener();
  const openMonth = open
    ? (m: string) => {
        const r = monthRange(m);
        open({
          categoryId: sub.parentId,
          includeChildren: true,
          from: r.from,
          to: r.to,
          rangeLabel: r.label,
          displayName: sub.parentName,
        });
      }
    : undefined;
  const openTotal = open
    ? () =>
        open({
          categoryId: sub.parentId,
          includeChildren: true,
          from,
          to,
          rangeLabel: totalRangeLabel(from, to),
          displayName: sub.parentName,
        })
    : undefined;
  return (
    <tr className={`border-b border-border/50 ${onToggle ? "cursor-pointer" : ""}`} onClick={onToggle}>
      <td className={`pl-9 pr-3 py-1.5 text-sm font-medium sticky left-0 bg-background whitespace-nowrap ${nameColor}`}>
        <span className="flex items-center gap-1">
          {onToggle && <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {href ? (
            <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-indigo-600 transition-colors">
              {sub.parentName}
            </Link>
          ) : sub.parentName}
        </span>
      </td>
      {months.map((m) => {
        const plan = planAt(sub.budgetByMonth, sub.scheduledByMonth, m);
        const actual = showValues ? sub.byMonth[m] : undefined;
        const over = isOverPlan(actual, plan, !!negate);
        return (
          <Fragment key={m}>
            {opts.showPlan && (
              <MonthSubCell value={plan} colHighlight={m === thisMonth} borderLeft />
            )}
            <AmountCell
              value={showValues ? display(sub.byMonth[m]) : undefined}
              colHighlight={m === thisMonth}
              muted={!over}
              overPlan={over}
              borderLeft={!opts.showPlan}
              onClick={showValues && openMonth ? () => openMonth(m) : undefined}
            />
            {opts.showCounts && <td className={m === thisMonth ? "bg-indigo-500/10" : ""} />}
          </Fragment>
        );
      })}
      {opts.showTotal && (
        <AmountCell
          value={showValues ? display(sub.total) : undefined}
          muted
          onClick={showValues ? openTotal : undefined}
        />
      )}
      {opts.showTotal && opts.showCounts && <td />}
      {opts.showAvg && <AmountCell value={showValues && months.length > 0 ? display(sub.total / months.length) : undefined} muted />}
      {opts.showPlan && <BudgetCell value={sub.budgetPerMonth + sub.scheduledPerMonth} />}
    </tr>
  );
}

function LeafRow({
  cat, months, thisMonth, negate, from, to, opts, indent,
}: {
  cat: CashflowCategory;
  months: string[];
  thisMonth: string;
  negate?: boolean;
  from: string;
  to: string;
  opts: ColOpts;
  indent: "none" | "child" | "grandchild";
}) {
  // Uncategorised synthetic rows ("uncategorised-income"/"uncategorised-expenses")
  // get a clickthrough to the transactions page filtered by NULL category, with
  // a direction filter so income and expense each open their own slice.
  const isUncategorised = cat.id.startsWith("uncategorised-");
  const uncatDirection = cat.id === "uncategorised-income"
    ? "in"
    : cat.id === "uncategorised-expenses"
      ? "out"
      : null;
  const cellCategoryId = isUncategorised ? "__uncat__" : cat.id;
  const href = isUncategorised
    ? `/transactions?categoryId=__uncat__&from=${from}&to=${to}${uncatDirection ? `&direction=${uncatDirection}` : ""}`
    : `/transactions?categoryId=${cat.id}&from=${from}&to=${to}`;
  const nameEl = isUncategorised
    ? <Link href={href} className="text-muted-foreground hover:underline hover:text-foreground transition-colors">{cat.name}</Link>
    : <Link href={href} className="hover:underline hover:text-indigo-600 transition-colors">{cat.name}</Link>;
  const tdClass =
    indent === "grandchild" ? "pl-16 pr-3 py-1.5 text-sm sticky left-0 bg-background whitespace-nowrap"
    : indent === "child"    ? "pl-9 pr-3 py-1.5 text-sm sticky left-0 bg-background whitespace-nowrap"
    :                         "px-3 py-1.5 text-sm sticky left-0 bg-background whitespace-nowrap";
  const open = useCellOpener();
  const openMonth = open
    ? (m: string) => {
        const r = monthRange(m);
        open({
          categoryId: cellCategoryId,
          from: r.from,
          to: r.to,
          rangeLabel: r.label,
          displayName: cat.name,
          direction: uncatDirection ?? undefined,
        });
      }
    : undefined;
  const openTotal = open
    ? () =>
        open({
          categoryId: cellCategoryId,
          from,
          to,
          rangeLabel: totalRangeLabel(from, to),
          displayName: cat.name,
          direction: uncatDirection ?? undefined,
        })
    : undefined;
  return (
    <tr className="hover:bg-muted/30 border-b border-border/50">
      <td className={tdClass}>{nameEl}</td>
      {months.map((m) => {
        const plan = planAt(cat.budgetByMonth, cat.scheduledByMonth, m);
        const over = isOverPlan(cat.byMonth[m], plan, !!negate);
        return (
          <Fragment key={m}>
            {opts.showPlan && (
              <MonthSubCell value={plan} colHighlight={m === thisMonth} borderLeft />
            )}
            <AmountCell
              value={cat.byMonth[m]}
              colHighlight={m === thisMonth}
              negate={negate}
              overPlan={over}
              borderLeft={!opts.showPlan}
              onClick={openMonth ? () => openMonth(m) : undefined}
            />
            {opts.showCounts && <CountCell value={cat.countByMonth[m]} colHighlight={m === thisMonth} />}
          </Fragment>
        );
      })}
      {opts.showTotal && <AmountCell value={cat.total} negate={negate} onClick={openTotal} />}
      {opts.showTotal && opts.showCounts && <CountCell value={cat.totalCount} />}
      {opts.showAvg && <AmountCell value={months.length > 0 ? cat.total / months.length : undefined} negate={negate} muted />}
      {opts.showPlan && <BudgetCell value={cat.budgetPerMonth + cat.scheduledPerMonth} />}
    </tr>
  );
}

function ChildRow(p: Omit<Parameters<typeof LeafRow>[0], "indent">) { return <LeafRow {...p} indent="child" />; }
function GrandchildRow(p: Omit<Parameters<typeof LeafRow>[0], "indent">) { return <LeafRow {...p} indent="grandchild" />; }
function StandaloneRow(p: Omit<Parameters<typeof LeafRow>[0], "indent">) { return <LeafRow {...p} indent="none" />; }

function TotalsRow({
  label, months, values, thisMonth, mode, negate, opts,
}: {
  label: string;
  months: string[];
  values: Record<string, number>;
  thisMonth: string;
  mode?: "plain" | "net" | "balance";
  negate?: boolean;
  opts: ColOpts;
}) {
  const total = Object.values(values).reduce((s, v) => s + v, 0);
  const avg = months.length > 0 ? total / months.length : undefined;
  return (
    <tr className="border-t-2 border-border font-semibold">
      <td className="px-3 py-2 text-sm sticky left-0 bg-muted/40 whitespace-nowrap">{label}</td>
      {months.map((m) => (
        <Fragment key={m}>
          {opts.showPlan && <td className={`px-2 py-2 border-l border-border ${m === thisMonth ? "bg-indigo-500/10" : ""}`} />}
          <AmountCell value={values[m]} colHighlight={m === thisMonth} mode={mode} negate={negate} borderLeft={!opts.showPlan} />
          {opts.showCounts && <td className={`px-2 py-2 ${m === thisMonth ? "bg-indigo-500/10" : ""}`} />}
        </Fragment>
      ))}
      {opts.showTotal && (mode === "balance" ? (
        <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">—</td>
      ) : (
        <AmountCell value={total} mode={mode} negate={negate} />
      ))}
      {opts.showTotal && opts.showCounts && <td className="px-2 py-2" />}
      {opts.showAvg && (mode === "balance" ? (
        <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">—</td>
      ) : (
        <AmountCell value={avg} mode={mode} negate={negate} muted />
      ))}
      {opts.showPlan && <td className="px-3 py-2 text-right text-muted-foreground/50 tabular-nums">—</td>}
    </tr>
  );
}

type TotalsLevel = "grandparent" | "parent" | "none";

interface ColOpts { showCounts: boolean; showTotal: boolean; showAvg: boolean; showPlan: boolean; }

interface CollapseState {
  collapsedGps: Set<string>;
  collapsedSubs: Set<string>;
  onToggleGp: (id: string) => void;
  onToggleSub: (id: string) => void;
}

function renderGroups(
  groups: DisplayGroup[],
  months: string[],
  thisMonth: string,
  negate: boolean,
  from: string,
  to: string,
  totalsLevel: TotalsLevel,
  collapse: CollapseState,
  opts: ColOpts
) {
  return groups.map((g) => {
    if (g.kind === "standalone") {
      return (
        <StandaloneRow
          key={g.cat.id}
          cat={g.cat}
          months={months}
          thisMonth={thisMonth}
          negate={negate}
          from={from}
          to={to}
          opts={opts}
        />
      );
    }

    return (
      <GrandparentRows
        key={`gp-${g.grandparentId}`}
        group={g}
        months={months}
        thisMonth={thisMonth}
        negate={negate}
        from={from}
        to={to}
        totalsLevel={totalsLevel}
        collapse={collapse}
        opts={opts}
      />
    );
  });
}

function GrandparentRows({
  group, months, thisMonth, negate, from, to, totalsLevel, collapse, opts,
}: {
  group: GrandparentGroup;
  months: string[];
  thisMonth: string;
  negate: boolean;
  from: string;
  to: string;
  totalsLevel: TotalsLevel;
  collapse: CollapseState;
  opts: ColOpts;
}) {
  const isGpCollapsed = collapse.collapsedGps.has(group.grandparentId);

  return (
    <>
      <ParentHeaderRow
        name={group.grandparentName}
        months={months}
        byMonth={group.byMonth}
        countByMonth={group.countByMonth}
        total={group.total}
        totalCount={group.totalCount}
        thisMonth={thisMonth}
        negate={negate}
        grandparent
        hasDirect={group.hasDirect}
        href={group.hasDirect ? `/transactions?categoryId=${group.grandparentId}&from=${from}&to=${to}` : undefined}
        showValues={totalsLevel === "grandparent"}
        opts={opts}
        budgetPerMonth={group.budgetPerMonth}
        scheduledPerMonth={group.scheduledPerMonth}
        budgetByMonth={group.budgetByMonth}
        scheduledByMonth={group.scheduledByMonth}
        isCollapsed={isGpCollapsed}
        onToggle={() => collapse.onToggleGp(group.grandparentId)}
        categoryIdForCell={group.grandparentId}
        fromForCell={from}
        toForCell={to}
      />
      {!isGpCollapsed && group.subGroups.map((sub) => {
        if (sub.children.length === 0) {
          return sub.parentCat ? (
            <ChildRow
              key={sub.parentId}
              cat={sub.parentCat}
              months={months}
              thisMonth={thisMonth}
              negate={negate}
              from={from}
              to={to}
              opts={opts}
            />
          ) : null;
        }
        const isSubCollapsed = collapse.collapsedSubs.has(sub.parentId);
        return (
          <Fragment key={`sub-${sub.parentId}`}>
            <SubParentHeaderRow
              sub={sub}
              months={months}
              thisMonth={thisMonth}
              negate={negate}
              from={from}
              to={to}
              showValues={totalsLevel !== "none"}
              opts={opts}
              isCollapsed={isSubCollapsed}
              onToggle={() => collapse.onToggleSub(sub.parentId)}
            />
            {!isSubCollapsed && sub.children.map((gc) => (
              <GrandchildRow
                key={gc.id}
                cat={gc}
                months={months}
                thisMonth={thisMonth}
                negate={negate}
                from={from}
                to={to}
                opts={opts}
              />
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

export function CashflowReport({
  from,
  to,
  accountIds,
  hideTransfers,
}: {
  from: string;
  to: string;
  accountIds: string[];
  hideTransfers: boolean;
}) {
  // SSR/client mismatch hazard: useState initializers run on the server
  // too, where localStorage doesn't exist. Use SSR-safe defaults here and
  // sync from localStorage in a mount-effect, otherwise hydration drops
  // the wrong value. (Saves write back to localStorage on every change.)
  const [totalsLevel, setTotalsLevel] = useState<TotalsLevel>("grandparent");
  const [showCounts, setShowCounts] = useState<boolean>(false);
  const [showTotal, setShowTotal] = useState<boolean>(true);
  const [showAvg, setShowAvg] = useState<boolean>(true);
  // Single Plan toggle (was separate Budget + Scheduled). A category never
  // has both a budget and a scheduled at the same time, so one column shows
  // whichever applies. Migrate from the old two keys on first read.
  const [showPlan, setShowPlan] = useState<boolean>(false);

  useEffect(() => {
    const lv = localStorage.getItem("cashflow-totals-level") as TotalsLevel | null;
    if (lv) setTotalsLevel(lv);
    setShowCounts(localStorage.getItem("cashflow-show-counts") === "true");
    setShowTotal(localStorage.getItem("cashflow-show-total") !== "false");
    setShowAvg(localStorage.getItem("cashflow-show-avg") !== "false");
    const cur = localStorage.getItem("cashflow-show-plan");
    if (cur !== null) {
      setShowPlan(cur === "true");
    } else {
      const oldB = localStorage.getItem("cashflow-show-budget") === "true";
      const oldS = localStorage.getItem("cashflow-show-scheduled") === "true";
      setShowPlan(oldB || oldS);
    }
  }, []);

  function toggleShowCounts() {
    setShowCounts((prev) => {
      const next = !prev;
      localStorage.setItem("cashflow-show-counts", String(next));
      return next;
    });
  }

  function toggleShowTotal() {
    setShowTotal((prev) => {
      const next = !prev;
      localStorage.setItem("cashflow-show-total", String(next));
      return next;
    });
  }

  function toggleShowAvg() {
    setShowAvg((prev) => {
      const next = !prev;
      localStorage.setItem("cashflow-show-avg", String(next));
      return next;
    });
  }

  function toggleShowPlan() {
    setShowPlan((prev) => {
      const next = !prev;
      localStorage.setItem("cashflow-show-plan", String(next));
      return next;
    });
  }

  const [collapsedGps, setCollapsedGps] = useState<Set<string>>(new Set());
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  const [cellQuery, setCellQuery] = useState<CashflowCellQuery | null>(null);

  function changeTotalsLevel(level: TotalsLevel) {
    setTotalsLevel(level);
    localStorage.setItem("cashflow-totals-level", level);
  }

  function toggleGp(id: string) {
    setCollapsedGps((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  function toggleSub(id: string) {
    setCollapsedSubs((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  const opts: ColOpts = { showCounts, showTotal, showAvg, showPlan };

  const accountIdsParam = accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const { data, isLoading } = useSWR<CashflowData>(
    `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
    fetcher
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading cashflow data…</p>;
  }
  if (!data || data.months.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No data for this period.</p>;
  }

  const { months, income, expenses, totals, closingBalance } = data;
  const thisMonth = format(new Date(), "yyyy-MM");
  const totalCols =
    1 + months.length +
    (showCounts ? months.length : 0) +
    // One per-month "Plan" sub-column when the toggle is on.
    (showPlan ? months.length : 0) +
    (showTotal ? (showCounts ? 2 : 1) : 0) +
    (showAvg ? 1 : 0) +
    (showPlan ? 1 : 0);

  const incomeGroups = buildGroups(income);
  const expenseGroups = buildGroups(expenses);

  const gpIds = [...incomeGroups, ...expenseGroups]
    .flatMap((g) => g.kind === "grandparent" ? [g.grandparentId] : []);
  const allCollapsed = gpIds.length > 0 && gpIds.every((id) => collapsedGps.has(id));

  function toggleCollapseAll() {
    if (allCollapsed) {
      setCollapsedGps(new Set());
      setCollapsedSubs(new Set());
    } else {
      setCollapsedGps(new Set(gpIds));
    }
  }

  const collapse: CollapseState = { collapsedGps, collapsedSubs, onToggleGp: toggleGp, onToggleSub: toggleSub };

  return (
    <CellOpenerContext.Provider value={setCellQuery}>
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        {/* Collapse all / Expand all */}
        <button
          onClick={toggleCollapseAll}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
        >
          {allCollapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />}
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>

        <div className="flex items-center gap-4">
        {/* Totals level segmented control */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Subtotals</span>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["grandparent", "parent", "none"] as TotalsLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => changeTotalsLevel(level)}
                className={`px-2.5 py-1 transition-colors ${
                  totalsLevel === level
                    ? "bg-indigo-600 text-white font-medium"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {level === "grandparent" ? "Full" : level === "parent" ? "Parent" : "None"}
              </button>
            ))}
          </div>
        </div>

        {/* Show total toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Total</span>
          <Switch checked={showTotal} onCheckedChange={toggleShowTotal} aria-label="Show total column" />
        </div>

        {/* Show avg toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Avg/mo</span>
          <Switch checked={showAvg} onCheckedChange={toggleShowAvg} aria-label="Show monthly average column" />
        </div>

        {/* Show plan toggle (combined budget + scheduled) */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Plan</span>
          <Switch checked={showPlan} onCheckedChange={toggleShowPlan} aria-label="Show plan columns" />
        </div>

        {/* Show counts toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show counts</span>
          <Switch checked={showCounts} onCheckedChange={toggleShowCounts} aria-label="Show transaction counts" />
        </div>

        </div>
      </div>
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted border-b">
            <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-muted w-44 min-w-44">
              Category
            </th>
            {months.map((m) => (
              <Fragment key={m}>
                {showPlan && (
                  <th className={`text-right px-2 py-2 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap border-l border-border ${m === thisMonth ? "bg-indigo-500/10" : ""}`}>
                    Plan
                  </th>
                )}
                <th
                  className={`text-right px-3 py-2 font-semibold whitespace-nowrap min-w-[90px] ${!showPlan ? "border-l border-border" : ""} ${
                    m === thisMonth ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" : ""
                  }`}
                >
                  {format(parseISO(`${m}-01`), "MMM ''yy")}
                </th>
                {showCounts && (
                  <th className={`text-right px-2 py-2 font-medium text-[11px] text-muted-foreground whitespace-nowrap min-w-[40px] ${m === thisMonth ? "bg-indigo-500/10" : ""}`}>
                    #
                  </th>
                )}
              </Fragment>
            ))}
            {showTotal && (
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap min-w-[90px]">
                Total
              </th>
            )}
            {showTotal && showCounts && (
              <th className="text-right px-2 py-2 font-medium text-[11px] text-muted-foreground whitespace-nowrap min-w-[40px]">#</th>
            )}
            {showAvg && (
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap min-w-[90px] text-muted-foreground">
                Avg/mo
              </th>
            )}
            {showPlan && (
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap min-w-[90px] text-muted-foreground/70">
                Plan/mo
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {/* ── SUMMARY ── */}
          <SectionHeader label="Summary" cols={totalCols} />
          <TotalsRow label="Closing Balance" months={months} values={closingBalance} thisMonth={thisMonth} mode="balance" opts={opts} />
          <TotalsRow label="Surplus / Deficit" months={months} values={totals.net} thisMonth={thisMonth} mode="net" opts={opts} />

          {/* ── INCOME ── */}
          <SectionHeader label="Income Categories" cols={totalCols} />
          {incomeGroups.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="px-3 py-3 text-muted-foreground text-xs">
                No income transactions in this period.
              </td>
            </tr>
          )}
          {renderGroups(incomeGroups, months, thisMonth, false, from, to, totalsLevel, collapse, opts)}
          <TotalsRow label="Total Income" months={months} values={totals.income} thisMonth={thisMonth} mode="net" opts={opts} />

          {/* ── EXPENSES ── */}
          <SectionHeader label="Expense Categories" cols={totalCols} />
          {expenseGroups.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="px-3 py-3 text-muted-foreground text-xs">
                No expense transactions in this period.
              </td>
            </tr>
          )}
          {renderGroups(expenseGroups, months, thisMonth, true, from, to, totalsLevel, collapse, opts)}
          <TotalsRow label="Total Expenses" months={months} values={totals.expenses} thisMonth={thisMonth} negate opts={opts} />
        </tbody>
      </table>
    </div>
    <CashflowCellDialog
      query={cellQuery}
      accountIds={accountIds}
      hideTransfers={hideTransfers}
      onClose={() => setCellQuery(null)}
    />
    </div>
    </CellOpenerContext.Provider>
  );
}
