"use client";

import { Fragment, useEffect, useRef, useMemo, useState } from "react";
import useSWR from "swr";
import { useSearchParams, useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  ArrowLeftRight, Unlink, X, StickyNote, Lock, Trash2, Search,
  // Icons used by `iconForType` to visually summarise the bank's
  // transaction-type field. Imported individually so tree-shaking can
  // drop unused glyphs.
  Receipt, Percent, TrendingUp, ShoppingCart, Banknote, FileCheck, Wallet,
  HandCoins, ArrowDownToLine, ArrowUpFromLine, Repeat, Pause, HelpCircle,
  CreditCard,
} from "lucide-react";
import { expandRecurrence } from "@/lib/recurrence";
import type { ScheduledTransaction } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { formatAUD, formatDate, amountClass, diffDaysISO, cn } from "@/lib/utils";
import { colourForFrequency } from "@/lib/schedule-colours";
import { buildCategoryMeta } from "@/lib/category-path";
import type { Category } from "@/db/schema";
import { CategoryPicker } from "@/components/transactions/category-picker";
import { ScheduleButton } from "@/components/transactions/schedule-button";
import { TransactionFilters } from "@/components/transactions/transaction-filters";
import { TransferSuggestionsPanel } from "@/components/transactions/transfer-suggestions-panel";
import { MissedScheduledPanel } from "@/components/transactions/missed-scheduled-panel";
import { NotesCell } from "@/components/transactions/notes-cell";
import { ScheduledMatchPill } from "@/components/transactions/scheduled-match-pill";
import { toast } from "sonner";

const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
const PAGE_SIZE_STORAGE_KEY = "transactions-page-size";
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

/** Map the bank's transaction type (OFX TRNTYPE / QIF L / CSV Categories)
 * to a lucide icon + tooltip label + muted tone class. Match is case-
 * insensitive and prefix-y so variants like "DIRECTDEP" / "DIRECT
 * DEPOSIT" / "Deposit" all hit the same bucket. Falls back to a generic
 * "?" icon for unknown values so the column never shows a raw string.
 *
 * Tones use the {colour}-500/70 opacity pattern so the icons stay
 * subtle — visible enough to scan without competing with the row's
 * actual content. Inflows green, outflows rose, transfers amber,
 * recurring cyan, fees red-rose, etc. */
function iconForType(rawType: string | null | undefined): {
  Icon: typeof Receipt;
  label: string;
  tone: string;
} | null {
  if (!rawType) return null;
  const t = rawType.trim().toUpperCase();
  if (!t) return null;
  // Inflow / income tones — emerald.
  const incoming = "text-emerald-500/70";
  // Outflow / spending tones — rose.
  const outgoing = "text-rose-500/70";
  // Order matters — FEE has to come before any FEE-prefix substrings.
  if (t === "FEE" || t === "SRVCHG" || t === "MISSED PAYMENT FEE") {
    return { Icon: Receipt, label: rawType, tone: "text-red-500/70" };
  }
  if (t === "INT" || t.startsWith("INTEREST")) {
    return { Icon: Percent, label: rawType, tone: "text-blue-500/70" };
  }
  if (t === "DIV" || t.startsWith("DIVIDEND")) {
    return { Icon: TrendingUp, label: rawType, tone: incoming };
  }
  if (t === "POS" || t.startsWith("POINT OF SALE") || t === "EFTPOS") {
    return { Icon: ShoppingCart, label: rawType, tone: "text-violet-500/70" };
  }
  if (t === "ATM") {
    return { Icon: CreditCard, label: rawType, tone: "text-slate-500/70" };
  }
  if (t === "CHECK" || t === "CHEQUE") {
    return { Icon: FileCheck, label: rawType, tone: "text-indigo-500/70" };
  }
  if (t === "CASH" || t === "DEP" || t.startsWith("DEPOSIT")) {
    return { Icon: Banknote, label: rawType, tone: incoming };
  }
  if (t === "DIRECTDEP" || t === "DIRECT DEP") {
    return { Icon: ArrowDownToLine, label: rawType, tone: incoming };
  }
  if (t === "DIRECTDEBIT" || t === "DIRECT DEBIT") {
    return { Icon: ArrowUpFromLine, label: rawType, tone: outgoing };
  }
  if (t === "REPEATPMT" || t.startsWith("REPEAT")) {
    return { Icon: Repeat, label: rawType, tone: "text-cyan-500/70" };
  }
  if (
    t === "XFER" ||
    t === "TRANSFER" ||
    t.startsWith("TFR") ||
    t.startsWith("TRANSFER")
  ) {
    return { Icon: ArrowLeftRight, label: rawType, tone: "text-amber-500/70" };
  }
  if (t === "PAYMENT" || t.startsWith("LOAN PAYMENT") || t.startsWith("AUTOMATIC PAYMENT")) {
    return { Icon: HandCoins, label: rawType, tone: outgoing };
  }
  if (t === "CREDIT") {
    return { Icon: ArrowDownToLine, label: rawType, tone: incoming };
  }
  if (t === "DEBIT") {
    return { Icon: ArrowUpFromLine, label: rawType, tone: outgoing };
  }
  if (t === "HOLD") {
    return { Icon: Pause, label: rawType, tone: "text-amber-500/70" };
  }
  if (t === "OTHER") {
    return { Icon: HelpCircle, label: rawType, tone: "text-slate-500/70" };
  }
  // Unknown / freeform — render a Wallet so the column has something
  // visual rather than nothing, with the raw text as the tooltip.
  return { Icon: Wallet, label: rawType, tone: "text-slate-500/70" };
}

const MATCH_TOLERANCE_DAYS = 3;

function ExpandedField({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </p>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}

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
  // SSR-safe default; localStorage read deferred to a post-mount effect so the
  // server-rendered HTML and the first client render agree.
  const [showNotes, setShowNotes] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Page-size — SSR-safe default, hydrated from localStorage on mount so
  // the initial render matches the server output and dodges a hydration
  // mismatch.
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  useEffect(() => {
    const stored = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const n = stored ? parseInt(stored, 10) : NaN;
    if ((PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) {
      setPageSize(n);
    }
  }, []);
  useEffect(() => {
    const stored = localStorage.getItem("transactions-show-notes");
    if (stored !== null) setShowNotes(stored !== "false");
  }, []);
  useEffect(() => {
    localStorage.setItem("transactions-show-notes", String(showNotes));
  }, [showNotes]);
  const [showLinkedDetails, setShowLinkedDetails] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("transactions-show-linked-details");
    if (stored !== null) setShowLinkedDetails(stored === "true");
  }, []);
  useEffect(() => {
    localStorage.setItem("transactions-show-linked-details", String(showLinkedDetails));
  }, [showLinkedDetails]);

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
  const { prefs: displayPrefs } = useDisplayPrefs();
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
      description: `Delete ${selectedIds.size} transaction${selectedIds.size === 1 ? "" : "s"}? This can't be undone.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    setBulkDeleting(true);
    const ids = Array.from(selectedIds);
    const res = await fetch("/api/transactions/bulk", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    setBulkDeleting(false);
    if (res.ok) {
      const data = await res.json().catch(() => ({ deleted: ids.length }));
      toast.success(
        `Deleted ${data.deleted} transaction${data.deleted === 1 ? "" : "s"}`,
      );
      clearSelection();
      mutateTxns();
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
              {showLinkedPanel && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer shrink-0">
                  <span>Linked details</span>
                  <Switch
                    checked={showLinkedDetails}
                    onCheckedChange={(v) => setShowLinkedDetails(v)}
                    aria-label="Show linked transfer details"
                  />
                </label>
              )}
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
                    <th aria-sort={sortAria("date")} className="text-left px-3 py-2 whitespace-nowrap w-[100px]">
                      <button onClick={() => handleSort("date")} className="hover:text-foreground transition-colors flex items-center">
                        Date{sortIndicator("date")}
                      </button>
                    </th>
                    <th aria-sort={sortAria("account")} className="text-left px-3 py-2 whitespace-nowrap w-[120px]">
                      <button onClick={() => handleSort("account")} className="hover:text-foreground transition-colors flex items-center">
                        Account{sortIndicator("account")}
                      </button>
                    </th>
                    <th aria-sort={sortAria("category")} className="text-left px-3 py-2 w-[160px]">
                      <button onClick={() => handleSort("category")} className="hover:text-foreground transition-colors flex items-center">
                        Category{sortIndicator("category")}
                      </button>
                    </th>
                    <th
                      className="px-2 py-2 w-[28px]"
                      title="Bank-supplied transaction type (OFX TRNTYPE / QIF L / CSV Categories)"
                    >
                      <span className="sr-only">Type</span>
                    </th>
                    <th aria-sort={sortAria("payee")} className="text-left px-3 py-2 w-full max-w-0">
                      <button onClick={() => handleSort("payee")} className="hover:text-foreground transition-colors flex items-center">
                        Payee{sortIndicator("payee")}
                      </button>
                    </th>
                    <th aria-sort={sortAria("value")} className="text-right px-3 py-2 whitespace-nowrap">
                      <button onClick={() => handleSort("value")} className="hover:text-foreground transition-colors flex items-center ml-auto">
                        Value{sortIndicator("value")}
                      </button>
                    </th>
                    {hasBalance && (
                      <th className="text-right px-3 py-2 whitespace-nowrap">Balance</th>
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
                    <th className="hidden lg:table-cell text-left px-3 py-2 whitespace-nowrap w-[140px]">
                      Linked account
                    </th>
                    {showLinkedDetails && (
                      <>
                        <th className="hidden lg:table-cell text-left px-3 py-2 max-w-[220px]">Linked payee</th>
                        <th className="hidden lg:table-cell text-right px-3 py-2 whitespace-nowrap">Linked value</th>
                      </>
                    )}
                    </>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {txns.map((t) => {
                    const match = findMatch(t);
                    const linked = !!t.transferPairId;
                    const isOutgoing = parseFloat(t.amount) < 0;
                    const isScheduledMatch = !!match;
                    const isSelected = selectedIds.has(t.id);
                    const stripeColour = isScheduledMatch ? colourForFrequency(match!.frequency) : undefined;
                    return (
                      <Fragment key={t.id}>
                      <tr
                        onClick={(e) => {
                          // Only treat clicks on inert cells as the expand
                          // trigger — anything inside an actual control
                          // (input, button, link, ARIA widget) keeps its
                          // own behaviour. closest() walks up from the
                          // click target so nested icons inside a button
                          // are caught too.
                          const el = e.target as HTMLElement;
                          if (
                            el.closest(
                              'a, button, input, label, select, textarea, ' +
                                '[role="button"], [role="combobox"], ' +
                                '[role="option"], [role="textbox"], ' +
                                '[data-no-expand]',
                            )
                          ) {
                            return;
                          }
                          setExpandedId((cur) => (cur === t.id ? null : t.id));
                        }}
                        className={`group cursor-pointer hover:bg-muted ${isSelected ? "bg-indigo-500/30 dark:bg-indigo-500/40" : ""}`}
                      >
                        <td
                          className="px-2 py-2 text-center"
                          style={stripeColour ? { boxShadow: `inset 3px 0 0 ${stripeColour}` } : undefined}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            aria-label={`Select transaction ${t.payee || t.date}`}
                            checked={isSelected}
                            onChange={() => toggleRow(t.id)}
                            className="cursor-pointer accent-indigo-600"
                          />
                        </td>
                        <td
                          className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap"
                          title={format(parseISO(t.date), "EEEE, d MMMM yyyy")}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {t.isReconciled && (
                              <Lock
                                className="h-3 w-3 text-emerald-600 shrink-0"
                                aria-label="Reconciled"
                              />
                            )}
                            {formatDate(t.date)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {t.accountName && (
                            <span
                              className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
                              style={{ backgroundColor: t.accountColor ?? "#94a3b8" }}
                            >
                              {t.accountName}
                            </span>
                          )}
                        </td>
                        <td
                          className="px-3 py-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CategoryPicker
                            transactionId={t.id}
                            categoryId={t.categoryId ?? null}
                            categoryName={t.categoryName ?? null}
                            categories={categories}
                          />
                        </td>
                        <td className="px-2 py-2 align-middle">
                          {(() => {
                            // Linked-transfer rows always show the
                            // transfer arrow in this column regardless of
                            // the bank's TRNTYPE — the link relationship
                            // is more relevant info than DEBIT/CREDIT.
                            if (linked) {
                              return (
                                <span
                                  className="inline-flex items-center justify-center text-amber-500/70"
                                  title="Linked transfer"
                                  aria-label="Linked transfer"
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" />
                                </span>
                              );
                            }
                            const meta = iconForType(t.type);
                            if (!meta) return null;
                            const { Icon, label, tone } = meta;
                            return (
                              <span
                                className={cn("inline-flex items-center justify-center", tone)}
                                title={label}
                                aria-label={`Type: ${label}`}
                              >
                                <Icon className="h-3.5 w-3.5" />
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-3 py-2 w-full max-w-0">
                          <div className="flex items-center justify-between gap-2 min-w-0">
                            <span className="font-medium flex items-center gap-1.5 min-w-0">
                              {/* Desktop only — on mobile the full payee is
                                  rendered on its own full-width row below
                                  (via the lg:hidden <tr> after this one).
                                  Truncating in-cell on mobile leaves the
                                  payee unreadable in a ~160px column. */}
                              <span className="hidden lg:inline truncate min-w-0">{t.payee || t.description || "—"}</span>
                              {!showNotes && t.notes?.trim() && (
                                <span
                                  className="inline-flex shrink-0 cursor-help"
                                  title={t.notes}
                                  aria-label={`Note: ${t.notes}`}
                                >
                                  <StickyNote className="h-3 w-3 text-amber-500" />
                                </span>
                              )}
                              {isScheduledMatch ? (
                                <ScheduledMatchPill
                                  scheduledId={match!.id}
                                  frequency={match!.frequency}
                                  interval={match!.interval}
                                  realDate={t.date}
                                  scheduledDate={match!.occurrenceDate}
                                  schedulePayee={match!.payee}
                                />
                              ) : (
                                <ScheduleButton
                                  transaction={{
                                    payee: t.payee,
                                    amount: t.amount,
                                    categoryId: t.categoryId ?? null,
                                    accountId: t.accountId,
                                    date: t.date,
                                    transferPairId: t.transferPairId,
                                    pairAccountId: t.pairAccountId,
                                  }}
                                  accounts={accounts}
                                  categoriesProp={categories as Category[]}
                                />
                              )}
                            </span>
                            {t.payee?.trim() && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const url = `https://www.google.com/search?q=${encodeURIComponent(t.payee!)}`;
                                  // Popup browser window — falls back to a
                                  // new tab if the browser ignores the
                                  // `popup` feature flag. Sized to leave
                                  // room beside the app on a typical
                                  // laptop screen.
                                  const w = Math.min(900, window.screen.availWidth - 100);
                                  const h = Math.min(720, window.screen.availHeight - 80);
                                  const left = Math.max(0, (window.screen.availWidth - w) / 2);
                                  const top = Math.max(0, (window.screen.availHeight - h) / 2);
                                  window.open(
                                    url,
                                    "payee-search",
                                    `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
                                  );
                                }}
                                className="shrink-0 p-1 -my-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                title={`Search Google for "${t.payee}"`}
                                aria-label="Search Google for this payee"
                              >
                                <Search className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {showNotes && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              <NotesCell
                                transactionId={t.id}
                                notes={t.notes}
                                onSaved={() => mutateTxns()}
                              />
                            </div>
                          )}
                          {linked && (
                            <span className="block lg:hidden text-[10px] text-muted-foreground mt-0.5 truncate">
                              ↔ {t.pairAccountName} · <span className={amountClass(t.pairAmount ?? "0")}>{formatAUD(t.pairAmount ?? "0")}</span>
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className={`font-semibold ${amountClass(t.amount)}`}>
                            {formatAUD(t.amount)}
                          </span>
                        </td>
                        {hasBalance && (
                          <td className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${t.balance != null ? amountClass(t.balance) : "text-muted-foreground"}`}>
                            {t.balance != null ? formatAUD(t.balance) : "—"}
                            {(() => {
                              // Cross-check: when the bank emitted a
                              // post-tx balance for this row, compare it
                              // to our computed running balance. Any
                              // discrepancy means a missing/extra row in
                              // our DB or a wrong amount somewhere —
                              // flag it inline so it can be investigated.
                              if (t.bankBalance == null || t.balance == null) return null;
                              const bank = parseFloat(t.bankBalance);
                              const computed = parseFloat(t.balance);
                              if (!Number.isFinite(bank) || !Number.isFinite(computed)) return null;
                              const delta = +(bank - computed).toFixed(2);
                              if (Math.abs(delta) < 0.01) return null;
                              return (
                                <span
                                  className="ml-1.5 text-red-600 font-semibold"
                                  title={`Bank says ${formatAUD(bank)} (Δ ${formatAUD(delta)})`}
                                  aria-label={`Bank balance mismatch — bank says ${formatAUD(bank)}`}
                                >
                                  ✗
                                </span>
                              );
                            })()}
                          </td>
                        )}
                        {/* Direction gutter + counterpart cells, hidden when
                            filtering to "No transfers" or when the linked
                            panel is turned off in Settings. */}
                        {showLinkedPanel && (
                        <>
                        <td className="hidden lg:table-cell border-l-2 border-border bg-muted/30 p-0 align-middle text-center">
                          {linked && (
                            <span
                              className={`inline-block text-xl leading-none font-bold ${isOutgoing ? "text-red-500" : "text-emerald-600"}`}
                              title={isOutgoing ? "Outgoing" : "Incoming"}
                              aria-label={isOutgoing ? "Outgoing" : "Incoming"}
                            >
                              {isOutgoing ? "→" : "←"}
                            </span>
                          )}
                        </td>
                        <td className="hidden lg:table-cell px-3 py-2 whitespace-nowrap">
                          {linked && t.pairAccountName ? (
                            <Link
                              href={`/transactions?accountId=${t.pairAccountId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] hover:opacity-80 transition-opacity"
                              style={{ backgroundColor: t.pairAccountColor ?? "#94a3b8" }}
                            >
                              {t.pairAccountName}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground/40 text-xs">—</span>
                          )}
                        </td>
                        {showLinkedDetails && (
                          <>
                            <td className="hidden lg:table-cell px-3 py-2 max-w-[220px]">
                              {linked ? (
                                <div className="flex items-center gap-1">
                                  <span className="truncate text-xs text-muted-foreground">{t.pairPayee || "—"}</span>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUnpair(t.id);
                                    }}
                                    className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                                    title="Unlink transfer"
                                  >
                                    <Unlink className="h-3 w-3" />
                                  </button>
                                </div>
                              ) : null}
                            </td>
                            <td className="hidden lg:table-cell px-3 py-2 text-right whitespace-nowrap">
                              {linked && t.pairAmount ? (
                                <span className={`font-semibold ${amountClass(t.pairAmount)}`}>
                                  {formatAUD(t.pairAmount)}
                                </span>
                              ) : null}
                            </td>
                          </>
                        )}
                        </>
                        )}
                      </tr>
                      {/* Mobile-only second row: the payee in full, spanning
                          every column. The tbody's `divide-y` would normally
                          add a top border between this and the main row;
                          `!border-t-0` overrides that so the payee reads as
                          part of the main row visually, and the next
                          transaction's own top divider serves as the
                          separator. Hidden on lg+ where the desktop layout's
                          inline payee handles it. */}
                      <tr className="lg:hidden !border-t-0 group cursor-pointer hover:bg-muted"
                          onClick={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}>
                        <td colSpan={100} className="px-3 pb-2 pt-0 text-sm font-medium break-words">
                          {t.payee || t.description || "—"}
                        </td>
                      </tr>
                      {expandedId === t.id && (
                        <tr className="bg-muted/40">
                          {/* colSpan=100 spans every visible column without
                              having to track which optional ones are on. */}
                          <td
                            colSpan={100}
                            className="px-6 py-3 border-b"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-xs">
                              <ExpandedField label="Notes" wide>
                                <NotesCell
                                  transactionId={t.id}
                                  notes={t.notes}
                                  onSaved={() => mutateTxns()}
                                />
                              </ExpandedField>
                              {t.description && (
                                <ExpandedField label="Description" wide>
                                  <span>{t.description}</span>
                                </ExpandedField>
                              )}
                              <ExpandedField label="Reconciled">
                                {t.isReconciled ? "Yes" : "No"}
                              </ExpandedField>
                              <ExpandedField label="Bank type">
                                {t.type ?? "—"}
                              </ExpandedField>
                              <ExpandedField label="Bank balance">
                                {t.bankBalance != null
                                  ? formatAUD(t.bankBalance)
                                  : "—"}
                              </ExpandedField>
                              <ExpandedField label="Posted">
                                {t.postedAt
                                  ? new Date(t.postedAt).toLocaleString()
                                  : "—"}
                              </ExpandedField>
                              <ExpandedField label="Posted seq">
                                {t.postedSeq ?? "—"}
                              </ExpandedField>
                              <ExpandedField label="Imported">
                                {new Date(t.createdAt).toLocaleString()}
                              </ExpandedField>
                              <ExpandedField label="Import format">
                                {t.importFormat
                                  ? t.importFormat.toUpperCase()
                                  : "Manual"}
                              </ExpandedField>
                              <ExpandedField label="Updated">
                                {new Date(t.updatedAt).toLocaleString()}
                              </ExpandedField>
                              <ExpandedField label="Bank ID (FITID)">
                                <code className="text-[11px] break-all">
                                  {t.rawFitid ?? "—"}
                                </code>
                              </ExpandedField>
                              <ExpandedField label="Import hash">
                                <code className="text-[11px] break-all">
                                  {t.importHash ?? "—"}
                                </code>
                              </ExpandedField>
                              <ExpandedField label="Normalised payee">
                                <code className="text-[11px] break-all">
                                  {t.normalizedPayee ?? "—"}
                                </code>
                              </ExpandedField>
                              <ExpandedField label="Transaction ID">
                                <code className="text-[11px] break-all">
                                  {t.id}
                                </code>
                              </ExpandedField>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
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
                          try {
                            localStorage.setItem(
                              PAGE_SIZE_STORAGE_KEY,
                              String(next),
                            );
                          } catch {}
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
    </>
  );
}
