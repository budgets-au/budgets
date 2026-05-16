"use client";

import { useEffect, useRef, useMemo, useState } from "react";
import useSWR from "swr";
import { useSearchParams, useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { parseISO } from "date-fns";
import { X, Trash2 } from "lucide-react";
import { expandRecurrence } from "@/lib/recurrence";
import type { ScheduledTransaction } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { formatAUD, amountClass, diffDaysISO, cn } from "@/lib/utils";
import { buildCategoryMeta } from "@/lib/category-path";
import type { Category } from "@/db/schema";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransferSuggestionsPanel } from "@/components/transactions/transfer-suggestions-panel";
import { MissedScheduledPanel } from "@/components/transactions/missed-scheduled-panel";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { LinkTransferDialog } from "@/components/transactions/link-transfer-dialog";
import { toast } from "sonner";

const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 200;

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TxRow {
  id: string;
  date: string;
  amount: string;
  payee: string | null;
  description: string | null;
  notes: string | null;
  accountId: string;
  accountName: string | null;
  accountColor: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transferPairId: string | null;
  pairAccountId: string | null;
  pairAccountName: string | null;
  pairAccountColor: string | null;
  pairAmount: string | null;
  pairDate: string | null;
  pairPayee: string | null;
  /** Running balance after this transaction. Only set when the list is
   * scoped to a single account; null otherwise. */
  balance: string | null;
  /** Bank-supplied balance at the time of this transaction (CSV
   * "Balance" column). When non-null, compared against `balance` so a
   * mismatch can be flagged in the UI. */
  bankBalance: string | null;
  isReconciled: boolean;
  /** Bank-supplied transaction type — e.g. OFX TRNTYPE (DEBIT, FEE),
   * QIF L, CSV Categories. Verbatim string; rendered as an icon by
   * `iconForType` so the table stays scannable. */
  type: string | null;
  // Metadata surfaced only in the row-expansion panel.
  isTransfer: boolean;
  normalizedPayee: string | null;
  postedAt: string | null;
  postedSeq: number | null;
  createdAt: string;
  updatedAt: string;
  importLogId: string | null;
  importHash: string | null;
  rawFitid: string | null;
  /** csv | ofx | qfx | qif — null when the row wasn't created via import. */
  importFormat: string | null;
}

/**
 * Mirrors the columns the schedule recurrence expander reads. The /api/scheduled
 * endpoint returns the full row, so we just narrow to the fields we need here.
 */
interface ScheduledRow {
  id: string;
  accountId: string;
  payee: string | null;
  description: string | null;
  amount: string;
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


const MATCH_TOLERANCE_DAYS = 3;


function shiftISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface Props {
  accounts: { id: string; name: string; color: string }[];
  initialCategories: { id: string; name: string; parentId: string | null }[];
}

export function TransactionsView({ accounts, initialCategories }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");
  const [bulkApplying, setBulkApplying] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Manual-link dialog state: a non-null source means the dialog is
  // open with that transaction as the "from" leg of the pair.
  const [linkTransferSource, setLinkTransferSource] = useState<{
    id: string;
    accountId: string;
    amount: string;
    date: string;
    payee: string | null;
  } | null>(null);
  // All three view-prefs (page size, show-notes, show-linked-details)
  // now live in the DB-backed display-prefs blob alongside the other
  // toggles so they follow the operator across systems instead of
  // drifting between browser localStorages.
  const { prefs: displayPrefs, setPref } = useDisplayPrefs();
  const showNotes = displayPrefs.transactionsShowNotes;
  const showLinkedDetails = displayPrefs.transactionsShowLinkedDetails;
  const rowExpandable = displayPrefs.transactionsRowExpandable;
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(
    displayPrefs.transactionsPageSize,
  )
    ? displayPrefs.transactionsPageSize
    : DEFAULT_PAGE_SIZE;
  const setShowNotes = (v: boolean) => setPref("transactionsShowNotes", v);
  // setShowLinkedDetails + setRowExpandable removed — those toggles
  // moved to Settings → General → Display.
  const setPageSize = (n: number) => setPref("transactionsPageSize", n);

  const { data: categories = initialCategories, mutate: mutateCategories } =
    useSWR<{ id: string; name: string; parentId: string | null }[]>(
      "/api/categories",
      fetcher,
      { fallbackData: initialCategories }
    );

  const accountId = searchParams.get("accountId") ?? "";
  const accountIdsParam = searchParams.get("accountIds") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const search = searchParams.get("search") ?? "";
  const sort = searchParams.get("sort") ?? "date";
  const order = searchParams.get("order") ?? "desc";
  const includeChildren = searchParams.get("includeChildren") === "true";
  const scheduledFilterRaw = searchParams.get("scheduledFilter");
  const scheduledFilter: "only" | "none" | null =
    scheduledFilterRaw === "only" || scheduledFilterRaw === "none"
      ? scheduledFilterRaw
      : null;
  const transfersFilterRaw = searchParams.get("transfersFilter");
  const transfersFilter: "only" | "none" | null =
    transfersFilterRaw === "only" || transfersFilterRaw === "none"
      ? transfersFilterRaw
      : searchParams.get("transfersOnly") === "true"
        ? "only"
        : null;
  // The linked-transactions panel (right-side counterpart pane) is
  // gated by both the URL transfersFilter ("none" hides it because
  // pairs are filtered out anyway) AND the user's persistent display
  // preference. Either condition false → panel hidden.
  const showLinkedPanel =
    transfersFilter !== "none" && displayPrefs.transactionsShowLinkedPanel;
  const directionRaw = searchParams.get("direction");
  const direction: "in" | "out" | null =
    directionRaw === "in" || directionRaw === "out" ? directionRaw : null;
  const pageRaw = searchParams.get("page") ?? "1";
  const page = Math.max(1, parseInt(pageRaw) || 1);

  const swrKey = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(pageSize));
    if (accountId) p.set("accountId", accountId);
    if (accountIdsParam) p.set("accountIds", accountIdsParam);
    if (categoryId) p.set("categoryId", categoryId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (search) p.set("search", search);
    p.set("sort", sort);
    p.set("order", order);
    if (includeChildren) p.set("includeChildren", "true");
    if (transfersFilter) p.set("transfersFilter", transfersFilter);
    if (direction) p.set("direction", direction);
    return `/api/transactions?${p.toString()}`;
  }, [page, pageSize, accountId, accountIdsParam, categoryId, from, to, search, sort, order, includeChildren, transfersFilter, direction]);

  const { data: txnsRaw = [], isLoading, mutate: mutateTxns } = useSWR<TxRow[]>(swrKey, fetcher, {
    keepPreviousData: true,
    // The transactions list is the heaviest query in the app. Tab-flip
    // shouldn't trigger a full refetch storm; user-driven mutations call
    // mutateTxns() explicitly when fresh data is actually needed.
    revalidateOnFocus: false,
    dedupingInterval: 5_000,
  });

  // Schedules barely change between page renders — long dedup window
  // collapses the multiple consumers (this view, missed panel,
  // calendar) into a single network round-trip.
  const { data: scheduledData = [] } = useSWR<ScheduledRow[]>("/api/scheduled", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  // Memoise so the heavy expandRecurrence + greedy-match memo downstream
  // doesn't re-run on every parent render — without this, hover state on a
  // single row causes the entire matcher to recompute over scheduledData ×
  // txns.
  const activeScheduled = useMemo(
    () => scheduledData.filter((s) => s.isActive),
    [scheduledData],
  );

  // Show the balance column only when the API actually has a per-row running
  // balance to give us — i.e. the request is scoped to a single account.
  const hasBalance = txnsRaw.some((t) => t.balance != null);

  // Greedy match scheduled occurrences against the raw txn pool. Computed
  // here (before the displayed `txns` is derived) so the scheduled-filter
  // dropdown can use this map to filter rows. Same algorithm as the
  // calendar / scheduled list views — matched by accountId + amount
  // within $0.01, ±MATCH_TOLERANCE_DAYS date drift.
  const scheduledMatchByTxnId = useMemo(() => {
    const out = new Map<string, { id: string; frequency: string; interval: number; occurrenceDate: string; payee: string | null }>();
    if (txnsRaw.length === 0 || activeScheduled.length === 0) return out;

    const dates = txnsRaw.map((t) => t.date);
    let minDate = dates[0];
    let maxDate = dates[0];
    for (const d of dates) {
      if (d < minDate) minDate = d;
      if (d > maxDate) maxDate = d;
    }
    const fromDate = parseISO(shiftISO(minDate, -MATCH_TOLERANCE_DAYS));
    const toDate = parseISO(shiftISO(maxDate, MATCH_TOLERANCE_DAYS));

    type Occ = {
      date: string;
      accountId: string;
      amount: number;
      scheduledId: string;
      frequency: string;
      interval: number;
      payee: string | null;
    };
    const occs: Occ[] = [];
    for (const s of activeScheduled) {
      const projected = expandRecurrence(s as ScheduledTransaction, fromDate, toDate);
      for (const p of projected) {
        occs.push({
          date: p.date,
          accountId: p.accountId,
          amount: parseFloat(p.amount),
          scheduledId: p.scheduledId,
          frequency: s.frequency,
          interval: s.interval,
          payee: s.payee,
        });
      }
    }
    if (occs.length === 0) return out;

    const claimed = new Set<number>();
    for (const t of txnsRaw) {
      const tAmount = parseFloat(t.amount);
      let bestIdx = -1;
      let bestDays = Infinity;
      occs.forEach((o, i) => {
        if (claimed.has(i)) return;
        if (o.accountId !== t.accountId) return;
        if (Math.abs(o.amount - tAmount) > 0.01) return;
        const days = Math.abs(diffDaysISO(o.date, t.date));
        if (days > MATCH_TOLERANCE_DAYS) return;
        if (days < bestDays) {
          bestDays = days;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) {
        claimed.add(bestIdx);
        const o = occs[bestIdx];
        out.set(t.id, {
          id: o.scheduledId,
          frequency: o.frequency,
          interval: o.interval,
          occurrenceDate: o.date,
          payee: o.payee,
        });
      }
    }
    return out;
  }, [txnsRaw, activeScheduled]);

  function findMatch(t: { id: string }) {
    return scheduledMatchByTxnId.get(t.id);
  }

  // Apply the scheduled filter client-side — match info isn't a server
  // concept (the match runs in the memo above), so the API can't
  // pre-filter. Pagination still uses the unfiltered count, so a heavily
  // filtered page may render fewer rows than the page size.
  const txns = useMemo(() => {
    if (scheduledFilter === "only") {
      return txnsRaw.filter((t) => scheduledMatchByTxnId.has(t.id));
    }
    if (scheduledFilter === "none") {
      return txnsRaw.filter((t) => !scheduledMatchByTxnId.has(t.id));
    }
    return txnsRaw;
  }, [txnsRaw, scheduledFilter, scheduledMatchByTxnId]);

  const countParams = new URLSearchParams();
  if (accountId) countParams.set("accountId", accountId);
  if (accountIdsParam) countParams.set("accountIds", accountIdsParam);
  if (categoryId) countParams.set("categoryId", categoryId);
  if (from) countParams.set("from", from);
  if (to) countParams.set("to", to);
  if (search) countParams.set("search", search);
  if (includeChildren) countParams.set("includeChildren", "true");
  if (transfersFilter) countParams.set("transfersFilter", transfersFilter);
  if (direction) countParams.set("direction", direction);
  const { data: countData } = useSWR<{ total: number }>(`/api/transactions/count?${countParams}`, fetcher);

  const allVisibleSelected =
    txns.length > 0 && txns.every((t) => selectedIds.has(t.id));
  const someVisibleSelected = !allVisibleSelected && txns.some((t) => selectedIds.has(t.id));

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const t of txns) next.delete(t.id);
        return next;
      }
      const next = new Set(prev);
      for (const t of txns) next.add(t.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkCategoryId("");
  }

  async function applyBulkCategory() {
    if (selectedIds.size === 0) return;
    setBulkApplying(true);
    const ids = Array.from(selectedIds);
    const categoryId = bulkCategoryId === "__uncat__" ? null : bulkCategoryId || null;
    const res = await fetch("/api/transactions/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, categoryId }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({ updated: ids.length }));
      toast.success(`Updated ${data.updated} transaction${data.updated === 1 ? "" : "s"}`);
      // Optimistic update: patch the affected rows in the SWR cache so the
      // category column flips immediately, then await the revalidation so
      // any join-derived fields (categoryName) catch up from the server
      // before we drop the busy state.
      const idSet = new Set(ids);
      const newCategoryName = categoryId
        ? (categoryMeta.get(categoryId)?.path.slice(-1)[0] ?? null)
        : null;
      await mutateTxns(
        (current) =>
          current?.map((t) =>
            idSet.has(t.id)
              ? { ...t, categoryId, categoryName: newCategoryName }
              : t,
          ),
        { revalidate: true },
      );
      clearSelection();
    } else {
      toast.error("Failed to update");
    }
    setBulkApplying(false);
  }

  const [bulkDeleting, setBulkDeleting] = useState(false);
  const confirmDialog = useConfirm();
  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    const ok = await confirmDialog({
      title: "Delete transactions",
      description: `Delete ${selectedIds.size} transaction${selectedIds.size === 1 ? "" : "s"}? An Undo button will surface in the toast for ~10 seconds.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    // Snapshot the row payloads BEFORE the DELETE fires so the
    // Undo handler has what it needs to re-POST. POST accepts a
    // narrower set of fields than the row carries (createSchema:
    // accountId/date/amount/payee/description/categoryId/notes/
    // isTransfer) — anything not in that list (balance, type,
    // posted_seq, transferPairId, importHash) is reconstructed on
    // insert or simply absent. Caveat: transfer-pair links don't
    // survive an undo cycle; if the operator deleted a paired
    // row, they'll need to re-pair it manually.
    const snapshot = txnsRaw
      .filter((t) => selectedIds.has(t.id))
      .map((t) => ({
        accountId: t.accountId,
        date: t.date,
        amount: t.amount,
        payee: t.payee ?? "",
        description: t.description ?? "",
        categoryId: t.categoryId,
        notes: t.notes ?? "",
        isTransfer: t.isTransfer,
      }));
    const res = await fetch("/api/transactions/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setBulkDeleting(false);
    if (res.ok) {
      const data = await res.json().catch(() => ({ deleted: ids.length }));
      clearSelection();
      mutateTxns();
      toast.success(
        `Deleted ${data.deleted} transaction${data.deleted === 1 ? "" : "s"}`,
        {
          // Sonner's action prop renders a button inside the toast.
          // Fires once, dismisses the toast on click. The 10 s
          // window is sonner's default; we don't override it so
          // the message follows the user's display-prefs.
          action: {
            label: "Undo",
            onClick: async () => {
              const results = await Promise.allSettled(
                snapshot.map((row) =>
                  fetch("/api/transactions", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(row),
                  }).then((r) => {
                    if (!r.ok) throw new Error(`POST ${r.status}`);
                    return r;
                  }),
                ),
              );
              const restored = results.filter(
                (r) => r.status === "fulfilled",
              ).length;
              if (restored === snapshot.length) {
                toast.success(`Restored ${restored} transaction${restored === 1 ? "" : "s"}`);
              } else {
                toast.error(
                  `Restored ${restored} of ${snapshot.length} — some inserts failed`,
                );
              }
              mutateTxns();
            },
          },
        },
      );
    } else {
      toast.error("Failed to delete");
    }
  }

  async function handleUnpair(txnId: string) {
    const res = await fetch(`/api/transactions/${txnId}/transfer-pair`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairId: null }),
    });
    if (res.ok) {
      toast.success("Transfer unlinked");
      mutateTxns();
    } else {
      toast.error("Failed to unlink");
    }
  }

  function handleSort(field: string) {
    const newOrder = sort === field && order !== "asc" ? "asc" : "desc";
    const p = new URLSearchParams(searchParams.toString());
    p.set("sort", field);
    p.set("order", newOrder);
    p.delete("page");
    router.push(`/transactions?${p.toString()}`);
  }

  function handleDirection(next: "in" | "out" | null) {
    const p = new URLSearchParams(searchParams.toString());
    if (next) p.set("direction", next);
    else p.delete("direction");
    p.delete("page");
    router.replace(`/transactions?${p.toString()}`);
  }

  function goToPage(n: number) {
    const p = new URLSearchParams(searchParams.toString());
    if (n <= 1) p.delete("page");
    else p.set("page", String(n));
    router.push(`/transactions?${p.toString()}`);
  }

  function sortIndicator(field: string) {
    if (sort !== field) return <span className="text-muted-foreground/40 ml-0.5">↕</span>;
    return <span className="ml-0.5">{order === "asc" ? "↑" : "↓"}</span>;
  }
  // ARIA sort state on a sortable <th>. "ascending" / "descending" /
  // "none" — screen readers announce the column's current direction.
  function sortAria(field: string): "ascending" | "descending" | "none" {
    if (sort !== field) return "none";
    return order === "asc" ? "ascending" : "descending";
  }

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const { meta: categoryMeta } = useMemo(() => buildCategoryMeta(categories), [categories]);
  const bulkCategoryLabel = (() => {
    if (bulkCategoryId === "__uncat__") return "Uncategorised";
    if (!bulkCategoryId) return "Choose category…";
    return categoryMeta.get(bulkCategoryId)?.path.join(" / ") ?? "Choose category…";
  })();

  return (
    <>
      <div className="flex items-start gap-3 flex-wrap">
        <TransactionFilters
          accounts={accounts}
          categories={categories}
          current={{
            accountId: accountId || undefined,
            accountIds: accountIdsParam || undefined,
            categoryId: categoryId || undefined,
            from: from || undefined,
            to: to || undefined,
            search: search || undefined,
            includeChildren,
            transfersFilter,
            scheduledFilter,
            direction,
          }}
        />
      </div>

      <TransferSuggestionsPanel onChanged={() => mutateTxns()} />

      <MissedScheduledPanel accounts={accounts} />

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 px-3 py-2 rounded-md border bg-background shadow-sm">
          <span className="text-xs font-medium text-foreground">
            {selectedIds.size} selected
          </span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">Assign category</span>
          <SearchableCombobox
            value={bulkCategoryId}
            onChange={setBulkCategoryId}
            items={categories
              .map((c) => {
                const m = categoryMeta.get(c.id);
                const path = m?.path ?? [c.name];
                return {
                  id: c.id,
                  label: path[path.length - 1],
                  ancestors: path.slice(0, -1),
                };
              })
              .sort((a, b) =>
                [...(a.ancestors ?? []), a.label]
                  .join(" / ")
                  .localeCompare(
                    [...(b.ancestors ?? []), b.label].join(" / "),
                  ),
              )}
            pinnedItems={[
              { id: "__uncat__", label: "Uncategorised", italic: true },
            ]}
            searchPlaceholder="Search categories…"
            emptyTriggerLabel="Choose category…"
            triggerClassName="h-8 text-xs w-[260px] border rounded-md px-3 bg-background inline-flex items-center justify-between gap-2"
          />
          <Button
            type="button"
            size="sm"
            onClick={applyBulkCategory}
            disabled={bulkApplying || !bulkCategoryId}
          >
            {bulkApplying ? "Applying…" : "Apply"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={bulkDelete}
            disabled={bulkDeleting}
            className="ml-2 border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-700"
            title={`Delete ${selectedIds.size} transaction${selectedIds.size === 1 ? "" : "s"}`}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {bulkDeleting ? "Deleting…" : "Delete"}
          </Button>
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Clear selection"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>
          ) : txns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">
              No transactions found. Use the Import button at the top to bring
              some in.
            </p>
          ) : (
            <>
            <div className="px-3 py-2 border-b flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                <span>Show notes</span>
                <Switch
                  checked={showNotes}
                  onCheckedChange={(v) => setShowNotes(v)}
                  aria-label="Show notes column"
                />
              </label>
              {countData && (
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {countData.total.toLocaleString()} transactions
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground font-medium">
                    <th className="px-2 py-2 w-[32px]">
                      <input
                        ref={headerCheckboxRef}
                        type="checkbox"
                        aria-label="Select all visible transactions"
                        checked={allVisibleSelected}
                        onChange={toggleAllVisible}
                        className="cursor-pointer accent-indigo-600"
                      />
                    </th>
                    {/* Columns auto-size to their widest content (HTML
                    table-layout default) so short cells like "Bills"
                    / "Loan" don't leave 60-80 px of dead space the
                    way the previous fixed widths did. Payee keeps
                    `w-full max-w-0` so it absorbs whatever space the
                    other columns don't claim. */}
                    <th aria-sort={sortAria("date")} className="text-left px-2 py-1.5 whitespace-nowrap">
                      <button onClick={() => handleSort("date")} className="hover:text-foreground transition-colors flex items-center">
                        Date{sortIndicator("date")}
                      </button>
                    </th>
                    <th aria-sort={sortAria("account")} className="text-left px-2 py-1.5 whitespace-nowrap">
                      <button onClick={() => handleSort("account")} className="hover:text-foreground transition-colors flex items-center">
                        Account{sortIndicator("account")}
                      </button>
                    </th>
                    <th aria-sort={sortAria("category")} className="text-left px-2 py-1.5">
                      <button onClick={() => handleSort("category")} className="hover:text-foreground transition-colors flex items-center">
                        Category{sortIndicator("category")}
                      </button>
                    </th>
                    <th
                      className="px-1 py-1.5 w-[28px]"
                      title="Bank-supplied transaction type (OFX TRNTYPE / QIF L / CSV Categories)"
                    >
                      <span className="sr-only">Type</span>
                    </th>
                    <th aria-sort={sortAria("payee")} className="text-left px-2 py-1.5 w-full max-w-0">
                      <button onClick={() => handleSort("payee")} className="hover:text-foreground transition-colors flex items-center">
                        Payee{sortIndicator("payee")}
                      </button>
                    </th>
                    <th aria-sort={sortAria("value")} className="text-right px-2 py-1.5 whitespace-nowrap">
                      <button onClick={() => handleSort("value")} className="hover:text-foreground transition-colors flex items-center ml-auto">
                        Value{sortIndicator("value")}
                      </button>
                    </th>
                    {hasBalance && (
                      <th className="text-right px-2 py-1.5 whitespace-nowrap">Balance</th>
                    )}
                    {/* Direction filter + counterpart pane — only meaningful
                        when paired rows can appear, so we hide the whole right
                        pane when the user has filtered to "No transfers" OR
                        turned the panel off in Settings → General → Display. */}
                    {showLinkedPanel && (
                    <>
                    <th className="hidden lg:table-cell border-l-2 border-border bg-muted/30 p-1 align-middle">
                      <div
                        role="radiogroup"
                        aria-label="Direction filter"
                        className="flex flex-col gap-0.5 items-stretch"
                      >
                        {([
                          { v: "in" as const,  label: "In",  cls: "text-emerald-600" },
                          { v: null as null,   label: "Both", cls: "text-muted-foreground" },
                          { v: "out" as const, label: "Out", cls: "text-red-500" },
                        ]).map((opt) => {
                          const active =
                            (opt.v === null && direction === null) ||
                            opt.v === direction;
                          return (
                            <button
                              key={opt.label}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              onClick={() => handleDirection(opt.v)}
                              className={`text-[10px] leading-tight px-1.5 py-0.5 rounded transition-colors ${
                                active
                                  ? `bg-background font-semibold ${opt.cls} shadow-sm`
                                  : `${opt.cls} opacity-50 hover:opacity-100`
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </th>
                    <th className="hidden lg:table-cell text-left px-2 py-1.5 whitespace-nowrap">
                      Linked account
                    </th>
                    {showLinkedDetails && (
                      <>
                        <th className="hidden lg:table-cell text-left px-2 py-1.5 max-w-[220px]">Linked payee</th>
                        <th className="hidden lg:table-cell text-right px-2 py-1.5 whitespace-nowrap">Linked value</th>
                      </>
                    )}
                    </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {txns.map((t) => {
                    const match = findMatch(t);
                    return (
                      <TransactionRow
                        key={t.id}
                        t={t}
                        accounts={accounts}
                        categories={categories}
                        showNotes={showNotes}
                        showLinkedPanel={showLinkedPanel}
                        showLinkedDetails={showLinkedDetails}
                        showBalance={hasBalance}
                        showDate
                        showCheckbox
                        isSelected={selectedIds.has(t.id)}
                        onToggleSelect={() => toggleRow(t.id)}
                        isExpanded={rowExpandable && expandedId === t.id}
                        onToggleExpand={
                          rowExpandable
                            ? () =>
                                setExpandedId((cur) =>
                                  cur === t.id ? null : t.id,
                                )
                            : undefined
                        }
                        match={
                          match
                            ? {
                                id: match.id,
                                frequency: match.frequency,
                                interval: match.interval,
                                occurrenceDate: match.occurrenceDate,
                                payee: match.payee,
                              }
                            : null
                        }
                        onUnpair={handleUnpair}
                        onRequestLink={setLinkTransferSource}
                        onChange={() => mutateTxns()}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const total = countData?.total ?? null;
              const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
              const startIdx = (page - 1) * pageSize;
              const endIdx = startIdx + txns.length;
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-xs">
                  <div className="flex items-center gap-3">
                    <p className="text-muted-foreground tabular-nums">
                      {total != null
                        ? txns.length === 0
                          ? `0 of ${total.toLocaleString()}`
                          : `${(startIdx + 1).toLocaleString()}–${endIdx.toLocaleString()} of ${total.toLocaleString()}`
                        : `Page ${page}`}
                    </p>
                    <label className="flex items-center gap-1 text-muted-foreground">
                      Rows
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          const next = parseInt(e.target.value, 10);
                          setPageSize(next);
                          // Reset to page 1 — the current page may exceed
                          // the new totalPages when the size shrinks.
                          goToPage(1);
                        }}
                        className="h-7 rounded border bg-background px-1.5 text-xs"
                      >
                        {PAGE_SIZE_OPTIONS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={page <= 1}
                      onClick={() => goToPage(1)}
                      aria-label="First page"
                    >
                      «
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={page <= 1}
                      onClick={() => goToPage(page - 1)}
                    >
                      ‹ Prev
                    </Button>
                    <span className="px-2 tabular-nums">
                      Page {page}
                      {totalPages != null ? ` of ${totalPages.toLocaleString()}` : ""}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={totalPages != null ? page >= totalPages : txns.length < pageSize}
                      onClick={() => goToPage(page + 1)}
                    >
                      Next ›
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={totalPages == null || page >= totalPages}
                      onClick={() => goToPage(totalPages ?? page)}
                      aria-label="Last page"
                    >
                      »
                    </Button>
                  </div>
                </div>
              );
            })()}
            </>
          )}
        </CardContent>
      </Card>
      <LinkTransferDialog
        source={linkTransferSource}
        open={linkTransferSource !== null}
        onOpenChange={(next) => {
          if (!next) setLinkTransferSource(null);
        }}
        onPaired={() => {
          mutateTxns();
        }}
      />
    </>
  );
}
