"use client";

import { useEffect, useMemo, useState } from "react";
import { useSwrJson } from "@/hooks/use-swr-json";
import Link from "next/link";
import { parseISO, subDays } from "date-fns";
import { AlertCircle, ChevronDown, ChevronRight, X, Undo2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import { colourForFrequency, freqLabel } from "@/lib/schedule-colours";
import { expandRecurrence } from "@/lib/recurrence";
import {
  matchSchedule,
  MATCH_TOLERANCE_DAYS_RANGE,
} from "@/lib/scheduled-match";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { ScheduledTransaction } from "@/db/schema";

const WINDOW_DAYS = 30;
/** Selectable grace-period values in the panel header. Spread covers
 * "alert immediately" (0d) through "weekend + long bank holiday"
 * (7d) and beyond for high-lag feeds. */
const GRACE_DAY_OPTIONS = [0, 1, 2, 3, 4, 5, 7, 10, 14] as const;

interface ScheduledRow {
  id: string;
  /** Schedules in the same lineage (e.g. amount changed over time) share
   * a lineageId. The matcher claims txns within a lineage so a single
   * real txn can't be assigned to two siblings, but lineages don't
   * compete with each other. */
  lineageId: string;
  accountId: string;
  payee: string | null;
  description: string | null;
  amount: string;
  /** When set, the schedule is "range-mode" (variable bill where the
   * actual amount fluctuates between amountMin and amount). Match logic
   * widens to that range and uses a longer date tolerance. */
  amountMin: string | null;
  type: string;
  categoryId: string | null;
  transferToAccountId: string | null;
  frequency: string;
  interval: number;
  startDate: string;
  endDate: string | null;
  dayOfMonth: number | null;
  isActive: boolean;
}

interface TxRow {
  id: string;
  date: string;
  amount: string;
  accountId: string;
  categoryId: string | null;
}

interface CategoryRow {
  id: string;
  parentId: string | null;
}

interface Account {
  id: string;
  name: string;
  color: string;
}

interface Dismissal {
  id: string;
  scheduledId: string;
  occurrenceDate: string;
  note: string;
  dismissedAt: string;
}

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

interface MissedOcc {
  scheduledId: string;
  date: string;
  accountId: string;
  amount: number;
  /** Lower bound of the matchable amount range (range-mode schedules);
   * null for fixed-amount schedules. */
  amountMin: number | null;
  payee: string;
  frequency: string;
  interval: number;
  type: string;
  transferToAccountId: string | null;
}

type DisplayRow =
  | { kind: "single"; occ: MissedOcc; dismissal: Dismissal | null }
  | {
      kind: "transfer";
      scheduledId: string;
      date: string;
      sourceAccountId: string;
      destAccountId: string;
      magnitude: number;
      payee: string;
      frequency: string;
      interval: number;
      dismissal: Dismissal | null;
    };

function rowKey(row: DisplayRow): { scheduledId: string; date: string } {
  if (row.kind === "single") return { scheduledId: row.occ.scheduledId, date: row.occ.date };
  return { scheduledId: row.scheduledId, date: row.date };
}

function rowLabel(row: DisplayRow): string {
  if (row.kind === "single") return row.occ.payee;
  return row.payee;
}

export function MissedScheduledPanel({ accounts }: { accounts: Account[] }) {
  const today = new Date();
  const fromISO = toISO(subDays(today, WINDOW_DAYS));
  const toISOStr = toISO(today);
  // The txn pool needs to extend further back than the occurrence window
  // by at least the date tolerance — otherwise an occurrence at the edge
  // of the window can have a matching txn that falls outside the fetched
  // pool and gets falsely flagged as missed. Use the wider range-mode
  // ceiling so range-mode matches (e.g. variable bills like Caravan/Loan)
  // also stay in the pool.
  const txnFromISO = toISO(subDays(today, WINDOW_DAYS + MATCH_TOLERANCE_DAYS_RANGE));

  const [expanded, setExpanded] = useState(false);
  // showDismissed + grace-period setting live in the DB-backed
  // display-prefs blob so they follow the operator across devices.
  const { prefs: displayPrefs, setPref } = useDisplayPrefs();
  const showDismissed = displayPrefs.missedShowDismissed;
  const setShowDismissed = (v: boolean) => setPref("missedShowDismissed", v);
  // Schedules due in the last N days still have room to post via the
  // bank feed before they get flagged. Default 4d swallows a normal
  // weekend + holiday lag without producing false-positive alerts.
  const graceDays = displayPrefs.scheduledMissedGraceDays;
  const graceCutoffISO = toISO(subDays(today, graceDays));

  const [dismissTarget, setDismissTarget] = useState<DisplayRow | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: scheduled = [] } = useSwrJson<ScheduledRow[]>("/api/scheduled");
  const { data: txns = [], isLoading } = useSwrJson<TxRow[]>(
    `/api/transactions?from=${txnFromISO}&to=${toISOStr}&limit=1000`,
  );
  // Categories are needed to expand a schedule's category to its
  // descendant subtree — the shared matcher uses that filter to avoid
  // claiming an unrelated same-amount txn for a range-mode schedule.
  const { data: categories = [] } = useSwrJson<CategoryRow[]>(
    "/api/categories",
  );
  const { data: dismissals = [], mutate: mutateDismissals } = useSwrJson<Dismissal[]>(
    "/api/scheduled/dismissed-missed",
  );

  const dismissalKey = (scheduledId: string, date: string) => `${scheduledId}#${date}`;
  const dismissalByKey = useMemo(() => {
    const m = new Map<string, Dismissal>();
    for (const d of dismissals) m.set(dismissalKey(d.scheduledId, d.occurrenceDate), d);
    return m;
  }, [dismissals]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const { active, dismissed } = useMemo(() => {
    if (scheduled.length === 0) return { active: [] as DisplayRow[], dismissed: [] as DisplayRow[] };
    const activeSchedules = scheduled.filter((s) => s.isActive);
    if (activeSchedules.length === 0) return { active: [], dismissed: [] };

    const fromDate = parseISO(fromISO);
    const toDate = parseISO(toISOStr);

    // Build a children-by-parent index once so each per-schedule
    // descendantSet call is cheap.
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

    // Match each schedule's projected occurrences against the txn pool
    // using the shared matcher. Greedy claim state is scoped per-lineage
    // — same as the scheduled list view — so two unrelated schedules
    // can't fight over the same txn (which would falsely flag one of
    // them as missed even when the scheduled view shows it matched).
    const unmatched: MissedOcc[] = [];

    const lineageGroups = new Map<string, ScheduledRow[]>();
    for (const s of activeSchedules) {
      const arr = lineageGroups.get(s.lineageId) ?? [];
      arr.push(s);
      lineageGroups.set(s.lineageId, arr);
    }

    for (const [, lineageMembers] of lineageGroups) {
      // Within a lineage, sort by startDate so the historic sibling runs
      // first and the current one picks up where it left off — same
      // ordering the scheduled view uses.
      const siblings = [...lineageMembers].sort((a, b) =>
        a.startDate.localeCompare(b.startDate),
      );
      const claimed = new Set<string>();

      for (const s of siblings) {
        // Single-leg projection for transfers: the destination's
        // existence is established by the source-leg match's
        // transfer_pair_id (resolved in the parent transactions view,
        // not here). Projecting both legs would force the destination
        // through matchSchedule's category filter, which it typically
        // fails because auto-pairing only categorises the source —
        // surfacing the destination as a false "missed" warning.
        const projected = expandRecurrence(
          s as unknown as ScheduledTransaction,
          fromDate,
          toDate,
          { transferDualLeg: false },
        );
        const rangeMin = s.amountMin != null ? Math.abs(parseFloat(s.amountMin)) : null;
        const allowedCategoryIds = s.categoryId ? descendantSet(s.categoryId) : null;
        // Run the shared matcher against the txn pool. No "posting lag"
        // cutoff — the scheduled view doesn't have one, and the user
        // wants today's due-but-not-yet-posted occurrences to surface
        // here too. The 5/14-day match tolerance still absorbs normal
        // bank feed lag retroactively once the txn does post.
        const matchable: MissedOcc[] = [];
        for (const p of projected) {
          matchable.push({
            scheduledId: s.id,
            date: p.date,
            accountId: p.accountId,
            amount: parseFloat(p.amount),
            amountMin: rangeMin,
            payee: s.payee ?? s.description ?? "—",
            frequency: s.frequency,
            interval: s.interval,
            type: s.type,
            transferToAccountId: s.transferToAccountId,
          });
        }
        if (matchable.length === 0) continue;

        const { unmatched: missed } = matchSchedule(
          matchable.map((m) => ({
            date: m.date,
            accountId: m.accountId,
            amount: m.amount,
          })),
          txns,
          {
            rangeMin,
            frequency: s.frequency,
            interval: s.interval,
            allowedCategoryIds,
            scheduleStartDate: s.startDate,
            scheduleEndDate: s.endDate,
            claimedTxnIds: claimed,
          },
        );
        for (const u of missed) {
          // Skip occurrences still inside the grace window — a bill
          // due today (or two days ago) hasn't had a chance to post
          // yet, so flagging it as missed would be a false positive.
          if (u.date > graceCutoffISO) continue;
          const meta = matchable.find(
            (m) =>
              m.date === u.date &&
              m.accountId === u.accountId &&
              m.amount === u.amount,
          );
          if (meta) unmatched.push(meta);
        }
      }
    }

    // Collapse transfer pairs (two unmatched legs sharing scheduledId+date).
    const groups = new Map<string, MissedOcc[]>();
    for (const u of unmatched) {
      const k = `${u.scheduledId}#${u.date}`;
      const arr = groups.get(k) ?? [];
      arr.push(u);
      groups.set(k, arr);
    }

    const all: DisplayRow[] = [];
    for (const [, group] of groups) {
      const first = group[0];
      const dismissal = dismissalByKey.get(dismissalKey(first.scheduledId, first.date)) ?? null;
      if (first.type === "transfer" && first.transferToAccountId && group.length === 2) {
        const source =
          group.find((g) => g.amount < 0) ?? group[0];
        const dest = group.find((g) => g !== source) ?? group[1];
        all.push({
          kind: "transfer",
          scheduledId: first.scheduledId,
          date: first.date,
          sourceAccountId: source.accountId,
          destAccountId: dest.accountId,
          magnitude: Math.abs(source.amount),
          payee: first.payee,
          frequency: first.frequency,
          interval: first.interval,
          dismissal,
        });
      } else {
        for (const occ of group) {
          all.push({
            kind: "single",
            occ,
            dismissal:
              dismissalByKey.get(dismissalKey(occ.scheduledId, occ.date)) ?? null,
          });
        }
      }
    }

    all.sort((a, b) => {
      const da = a.kind === "single" ? a.occ.date : a.date;
      const db = b.kind === "single" ? b.occ.date : b.date;
      return da < db ? 1 : -1;
    });

    return {
      active: all.filter((r) => !r.dismissal),
      dismissed: all.filter((r) => r.dismissal),
    };
  }, [scheduled, txns, fromISO, toISOStr, dismissalByKey, accountById, categories, graceCutoffISO]);

  // Hide only when there's literally nothing to show. If everything has been
  // dismissed, the panel still renders so the user can find the toggle and
  // restore items — otherwise they'd be stuck with no way back into the list.
  if (isLoading || (active.length === 0 && dismissed.length === 0)) {
    return null;
  }

  function openDismiss(row: DisplayRow) {
    setDismissTarget(row);
    setNoteDraft(row.dismissal?.note ?? "");
  }

  async function confirmDismiss() {
    if (!dismissTarget) return;
    const { scheduledId, date } = rowKey(dismissTarget);
    setBusy(true);
    const res = await fetch(`/api/scheduled/${scheduledId}/dismiss-missed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ occurrenceDate: date, note: noteDraft.trim() }),
    });
    setBusy(false);
    if (res.ok) {
      toast.success("Dismissed");
      setDismissTarget(null);
      setNoteDraft("");
      mutateDismissals();
    } else {
      toast.error("Failed to dismiss");
    }
  }

  async function restoreDismissal(row: DisplayRow) {
    const { scheduledId, date } = rowKey(row);
    const res = await fetch(
      `/api/scheduled/${scheduledId}/dismiss-missed?occurrenceDate=${encodeURIComponent(date)}`,
      { method: "DELETE" },
    );
    if (res.ok) {
      toast.success("Restored");
      mutateDismissals();
    } else {
      toast.error("Failed to restore");
    }
  }

  function renderActiveRow(row: DisplayRow, i: number) {
    const { scheduledId, date } = rowKey(row);
    const baseRow = (
      <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-[68px]">
        {formatDate(date)}
      </span>
    );
    if (row.kind === "single") {
      const m = row.occ;
      const acct = accountById.get(m.accountId);
      return (
        <li
          key={`active#${scheduledId}#${date}#${i}`}
          className="group flex items-center gap-2 px-3 py-2 text-sm"
        >
          {baseRow}
          {acct && (
            <span
              className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
              style={{ backgroundColor: acct.color }}
            >
              {acct.name}
            </span>
          )}
          <Link
            href={`/scheduled/${m.scheduledId}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap hover:opacity-80 transition-opacity shrink-0"
            style={{ backgroundColor: colourForFrequency(m.frequency) }}
          >
            {freqLabel(m.frequency, m.interval)}
          </Link>
          <span className="truncate flex-1 min-w-0">{m.payee}</span>
          <span className={`shrink-0 font-medium tabular-nums ${amountClass(m.amount)}`}>
            {formatAUD(m.amount)}
          </span>
          <button
            type="button"
            onClick={() => openDismiss(row)}
            className="lg:opacity-0 lg:group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-amber-500/15 text-muted-foreground hover:text-amber-700"
            title="Dismiss with a note"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </li>
      );
    }
    const sourceAcct = accountById.get(row.sourceAccountId);
    const destAcct = accountById.get(row.destAccountId);
    return (
      <li
        key={`active#${scheduledId}#${date}#${i}`}
        className="group flex items-center gap-2 px-3 py-2 text-sm"
      >
        {baseRow}
        {sourceAcct && (
          <span
            className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
            style={{ backgroundColor: sourceAcct.color }}
          >
            {sourceAcct.name}
          </span>
        )}
        <span className="text-muted-foreground shrink-0" aria-hidden="true">→</span>
        {destAcct && (
          <span
            className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
            style={{ backgroundColor: destAcct.color }}
          >
            {destAcct.name}
          </span>
        )}
        <Link
          href={`/scheduled/${row.scheduledId}`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap hover:opacity-80 transition-opacity shrink-0"
          style={{ backgroundColor: colourForFrequency(row.frequency) }}
        >
          {freqLabel(row.frequency, row.interval)}
        </Link>
        <span className="truncate flex-1 min-w-0">{row.payee}</span>
        <span className="shrink-0 font-medium tabular-nums text-foreground">
          {formatAUD(row.magnitude)}
        </span>
        <button
          type="button"
          onClick={() => openDismiss(row)}
          className="lg:opacity-0 lg:group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-amber-500/15 text-muted-foreground hover:text-amber-700"
          title="Dismiss with a note"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </li>
    );
  }

  function renderDismissedRow(row: DisplayRow, i: number) {
    const { scheduledId, date } = rowKey(row);
    const note = row.dismissal?.note ?? "";
    return (
      <li
        key={`dismissed#${scheduledId}#${date}#${i}`}
        className="group flex flex-col gap-0.5 px-3 py-2 text-sm opacity-60 hover:opacity-90 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-[68px]">
            {formatDate(date)}
          </span>
          {row.kind === "single" ? (
            <>
              {(() => {
                const acct = accountById.get(row.occ.accountId);
                return acct ? (
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
                    style={{ backgroundColor: acct.color }}
                  >
                    {acct.name}
                  </span>
                ) : null;
              })()}
            </>
          ) : (
            <>
              {(() => {
                const a = accountById.get(row.sourceAccountId);
                return a ? (
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
                    style={{ backgroundColor: a.color }}
                  >
                    {a.name}
                  </span>
                ) : null;
              })()}
              <span className="text-muted-foreground shrink-0" aria-hidden="true">→</span>
              {(() => {
                const a = accountById.get(row.destAccountId);
                return a ? (
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
                    style={{ backgroundColor: a.color }}
                  >
                    {a.name}
                  </span>
                ) : null;
              })()}
            </>
          )}
          <Link
            href={`/scheduled/${scheduledId}`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-medium whitespace-nowrap hover:opacity-80 transition-opacity shrink-0"
            style={{
              backgroundColor: colourForFrequency(
                row.kind === "single" ? row.occ.frequency : row.frequency,
              ),
            }}
          >
            {freqLabel(
              row.kind === "single" ? row.occ.frequency : row.frequency,
              row.kind === "single" ? row.occ.interval : row.interval,
            )}
          </Link>
          <span className="truncate flex-1 min-w-0 line-through">{rowLabel(row)}</span>
          <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
            {formatAUD(row.kind === "single" ? row.occ.amount : row.magnitude)}
          </span>
          <button
            type="button"
            onClick={() => restoreDismissal(row)}
            className="lg:opacity-0 lg:group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Restore"
            aria-label="Restore"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
        </div>
        {note && (
          <span className="pl-[76px] text-xs text-muted-foreground italic truncate">
            “{note}”
          </span>
        )}
      </li>
    );
  }

  return (
    <>
      <div
        data-testid="missed-scheduled-panel"
        className={`rounded-md border ${
          active.length > 0
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-muted/30"
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 flex-1 text-sm hover:opacity-80 transition-opacity text-left"
          >
            <span
              className={`flex items-center gap-2 ${
                active.length > 0 ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground"
              }`}
            >
              <AlertCircle className="h-4 w-4" />
              <span className="font-medium">
                {active.length === 0
                  ? `No missed scheduled transactions (last ${WINDOW_DAYS} days)`
                  : `${active.length} missed scheduled transaction${active.length === 1 ? "" : "s"} (last ${WINDOW_DAYS} days)`}
              </span>
            </span>
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
            )}
          </button>
          <label
            className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0"
            onClick={(e) => e.stopPropagation()}
            title="Wait this many days after the due date before flagging a missing transaction. Absorbs normal bank-feed lag."
          >
            <span>Grace</span>
            <select
              value={graceDays}
              onChange={(e) =>
                setPref("scheduledMissedGraceDays", parseInt(e.target.value, 10))
              }
              className="bg-background border rounded px-1 py-0.5 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-indigo-500"
              aria-label="Grace period before flagging missed transactions"
            >
              {GRACE_DAY_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}d
                </option>
              ))}
            </select>
          </label>
          {dismissed.length > 0 && (
            <label
              className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <span>Show {dismissed.length} dismissed</span>
              <Switch
                checked={showDismissed}
                onCheckedChange={(v) => setShowDismissed(v)}
                aria-label="Show dismissed missed schedules"
              />
            </label>
          )}
        </div>
        {expanded && (
          <ul
            className={`divide-y border-t ${
              active.length > 0
                ? "divide-amber-500/20 border-amber-500/30"
                : "divide-border border-border"
            }`}
          >
            {active.map(renderActiveRow)}
            {showDismissed && dismissed.map(renderDismissedRow)}
          </ul>
        )}
      </div>

      <Dialog open={dismissTarget !== null} onOpenChange={(o) => !o && setDismissTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Dismiss missed transaction</DialogTitle>
          </DialogHeader>
          {dismissTarget && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {formatDate(rowKey(dismissTarget).date)} · {rowLabel(dismissTarget)}
              </div>
              <div className="space-y-1">
                <Label htmlFor="dismiss-note">Note (optional)</Label>
                <textarea
                  id="dismiss-note"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Why was this skipped? e.g. cancelled the policy"
                  rows={3}
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button onClick={confirmDismiss} disabled={busy} className="flex-1">
                  {busy ? "Dismissing…" : "Dismiss"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDismissTarget(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
