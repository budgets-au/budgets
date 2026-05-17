"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
import { useAddAccount } from "@/hooks/use-add-account-dialog";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { formatAUD, amountClass, cn } from "@/lib/utils";
import { stashPendingUndoImport } from "@/lib/import-undo";

interface CategoryOption {
  id: string;
  name: string;
  parentId: string | null;
  type: "income" | "expense" | string;
}

interface AccountOption {
  id: string;
  name: string;
  type: string;
  accountNumberLast4: string | null;
  institution?: string | null;
}

interface Neighbour {
  normalizedPayee: string;
  similarity: number;
  amount: number;
  categoryName: string | null;
}

interface CategoryRange {
  categoryName: string | null;
  support: number;
  minAmount: number;
  maxAmount: number;
  isPicked: boolean;
}

interface QIFAccountInfo {
  name?: string;
  type?: string;
  description?: string;
  balance?: string;
}

interface QIFSplit {
  category?: string;
  memo?: string;
  amount?: string;
}

interface OFXBalance {
  amount: string;
  asOf: string | null;
}

interface OFXMeta {
  institution?: string;
  accountId?: string;
  accountType?: string;
  bankId?: string;
  currency?: string;
  statementStart?: string;
  statementEnd?: string;
  ledgerBalance?: OFXBalance;
  availableBalance?: OFXBalance;
}

interface TestResultRow {
  date: string;
  amount: string;
  payee: string;
  normalizedPayee: string;
  importHash: string;
  rawId: string;
  method: "rule" | "trigram" | "none";
  categoryId: string | null;
  categoryName: string | null;
  score?: number;
  support?: number;
  neighbours?: Neighbour[];
  categoryRanges?: CategoryRange[];
  matchType?: "exact" | "legacy" | "possible";
  existingDate?: string | null;
  existingAmount?: string | null;
  existingPayee?: string | null;
  existingCategoryName?: string | null;
  existingAccountName?: string | null;
  existingType?: string | null;
  existingBalance?: string | null;
  existingPostedSeq?: number | null;
  balanceCheck?: {
    match: boolean;
    predicted: number;
    claimed: number;
    delta: number;
    mode: "chain" | "anchor";
  };
  balanceCheckVsDB?: {
    match: boolean;
    expected: number;
    claimed: number;
    delta: number;
  };
  resolvedType?: string | null;
  resolvedAccountId?: string | null;
  resolvedAccountName?: string | null;
  resolvedAccountVia?: "alias" | "last4" | "heuristic-match" | null;
  qifAccount?: QIFAccountInfo;
  qifSectionType?: string;
  checkNum?: string;
  cleared?: string;
  bankCategory?: string;
  address?: string[];
  splits?: QIFSplit[];
  trnType?: string;
  refNum?: string;
  runningBalance?: string;
  postedSeq?: number | null;
}

interface TestResponse {
  format: string;
  total: number;
  summary: { rule: number; trigram: number; none: number };
  matchSummary?: {
    newRows: number;
    exact: number;
    legacy: number;
    possible: number;
  };
  ofxMeta?: OFXMeta;
  qifAccountSummary: { name: string; type?: string; count: number }[];
  fieldStats: {
    withBankCategory: number;
    withCheckNum: number;
    withCleared: number;
    withSplits: number;
    withTrnType: number;
    withRefNum: number;
    withRunningBalance: number;
  };
  rows: TestResultRow[];
}

export function ImportView() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TestResponse | null>(null);
  const [accountFilter, setAccountFilter] = useState<string | "all">("all");
  /** Show the exact-match rows whose DB row already has every
   * user-visible field set — by default these are hidden because
   * commit is a no-op for them. Off matches the cleaner default
   * the operator usually wants; on for "show me everything in
   * the file" diagnostics. */
  const [showIdentical, setShowIdentical] = useState(false);
  /** Which row is expanded. Single-row-open-at-a-time matches the
   * Transactions page (transactions-view.tsx → `expandedId`). */
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // SWR-backed so the global cache invalidation from the
  // Add-Category dialog reaches this list — without it, the in-row
  // "Create new category" affordance can't render the new label
  // until the page is refreshed.
  const { data: categories = [] } = useSWR<CategoryOption[]>(
    "/api/categories",
    (url: string) => fetch(url).then((r) => r.json()),
  );
  // The unresolved-account resolver below needs the live account list
  // to populate its picker; sharing the SWR key means a new account
  // created mid-import (via the "Create new account" affordance)
  // shows up in the picker immediately via optimistic write.
  const { data: accounts = [] } = useSWR<AccountOption[]>(
    "/api/accounts",
    (url: string) => fetch(url).then((r) => r.json()),
  );
  /** Optimistic category overrides keyed by importHash so the chip flips
   * instantly when the user creates a rule via the in-row picker. */
  const [localOverrides, setLocalOverrides] = useState<
    Map<string, { categoryId: string; categoryName: string }>
  >(new Map());
  /** Per-bank-id account overrides. Keyed by `qifAccount?.name ?? ""`
   *  — every row sharing the same bank identifier picks up the same
   *  resolution. Lets the operator clear all "unresolved account"
   *  rows in one click. */
  const [accountOverrides, setAccountOverrides] = useState<
    Map<string, { accountId: string; accountName: string }>
  >(new Map());

  const [file, setFile] = useState<File | null>(null);

  const runCategorise = useCallback(async (target: File) => {
    setLoading(true);
    setExpandedKey(null);
    const fd = new FormData();
    fd.append("file", target);
    // Both stages always on — the pipeline A/B toggles were a
    // categoriser dev tool from when the trigram path was being
    // built; the operator UI doesn't need them.
    fd.append("useRules", "true");
    fd.append("useTrigram", "true");
    const res = await fetch("/api/import/categorise", {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const { error } = await res
        .json()
        .catch(() => ({ error: "Categorisation failed" }));
      toast.error(error ?? "Categorisation failed");
      setLoading(false);
      return;
    }
    const json: TestResponse = await res.json();
    setData(json);
    setAccountFilter("all");
    setLoading(false);
  }, []);

  const onDrop = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setData(null);
      await runCategorise(f);
    },
    [runCategorise],
  );

  // First-time-format guard. Fires once the parse has produced a format
  // and runs BEFORE the user can map accounts or commit, so a wrong
  // format pick is caught up-front.
  const promptedFormatRef = useRef<string | null>(null);
  const confirmFn = useConfirm();
  const fileNameForPrompt = file?.name ?? null;
  useEffect(() => {
    const fmt = data?.format;
    if (!fmt) return;
    if (promptedFormatRef.current === fmt) return;
    promptedFormatRef.current = fmt;
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/import/format-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: fmt, accountIds: [] }),
      });
      if (!res.ok) return;
      const { formatNewGlobally, totalsByFormat } = (await res.json()) as {
        formatNewGlobally: boolean;
        totalsByFormat: Record<string, number>;
      };
      if (!formatNewGlobally) return;
      if (cancelled) return;
      const breakdown = Object.entries(totalsByFormat ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([f, n]) => `${f.toUpperCase()}: ${n.toLocaleString()}`)
        .join(" · ");
      const ok = await confirmFn({
        title: `First ${fmt.toUpperCase()} import`,
        description: `${fileNameForPrompt ? `"${fileNameForPrompt}" looks like a ${fmt.toUpperCase()} file. ` : ""}You haven't imported a ${fmt.toUpperCase()} file before.\n\nCurrent imports by format → ${breakdown || "none yet"}\n\n${fmt.toUpperCase()} hashes don't line up with other formats — re-importing the same statement in a different format will create duplicates instead of matching. Make sure this is the format you want to use going forward.\n\nProceed with parsing?`,
        confirmLabel: `Use ${fmt.toUpperCase()}`,
      });
      if (cancelled) return;
      if (!ok) {
        setFile(null);
        setData(null);
        promptedFormatRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.format, fileNameForPrompt, confirmFn]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/x-ofx": [".ofx", ".qfx"],
      "application/qif": [".qif"],
      "text/plain": [".csv", ".ofx", ".qfx", ".qif"],
    },
    multiple: false,
  });

  // Apply local overrides + filter out exact-noop rows (the commit
  // would skip them anyway, surfacing 40 identical OFX rows wastes
  // the operator's eye). Account filter still applies.
  const effectiveRows = useMemo(() => {
    return (data?.rows ?? []).map((r) => {
      let next = r;
      const c = localOverrides.get(r.importHash);
      if (c) {
        next = {
          ...next,
          method: "rule" as const,
          categoryId: c.categoryId,
          categoryName: c.categoryName,
          score: undefined,
          support: undefined,
        };
      }
      // Account override: any row whose bank-id is in the override
      // map gets its resolved-account fields rewritten so the commit
      // payload + the chip/expand UI see the operator's choice.
      const a = accountOverrides.get(r.qifAccount?.name ?? "");
      if (a) {
        next = {
          ...next,
          resolvedAccountId: a.accountId,
          resolvedAccountName: a.accountName,
          resolvedAccountVia: "alias" as const,
        };
      }
      return next satisfies TestResultRow;
    });
  }, [data?.rows, localOverrides, accountOverrides]);

  const filteredRows = effectiveRows.filter((r) => {
    if (accountFilter !== "all" && (r.qifAccount?.name ?? "") !== accountFilter)
      return false;
    if (!showIdentical && isExactNoOp(r)) return false;
    return true;
  });

  function handleRuleCreated(importHash: string, cat: CategoryOption) {
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      next.set(importHash, { categoryId: cat.id, categoryName: cat.name });
      return next;
    });
  }

  const showAccountColumn = (data?.qifAccountSummary.length ?? 0) >= 2;

  const newRowCount = data?.matchSummary?.newRows ?? 0;
  const duplicateCount =
    (data?.matchSummary?.exact ?? 0) +
    (data?.matchSummary?.legacy ?? 0) +
    (data?.matchSummary?.possible ?? 0);
  const hiddenIdenticalCount = effectiveRows.filter(isExactNoOp).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Drop a bank export (CSV, OFX, QFX, or QIF) to import. Each row
            is auto-routed to the right account, deduped against the
            existing DB, and categorised. Click a row to see its source
            metadata and override the category.
          </p>
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors",
              isDragActive
                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30"
                : "border-slate-300 dark:border-slate-700 hover:border-slate-400",
            )}
          >
            <input {...getInputProps()} />
            <Upload className="h-10 w-10 mx-auto mb-4 text-slate-400" />
            <p className="text-base font-medium">
              {isDragActive
                ? "Drop the file here"
                : "Drag & drop a CSV / OFX / QFX / QIF"}
            </p>
            {loading && (
              <p className="text-sm text-blue-600 mt-3 animate-pulse">
                Categorising…
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {data && (
        <>
          {/* File header: name + (OFX-only) institution/BSB subtitle +
            a single inline count line. Replaces the previous five
            stat-cards stack. */}
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {file?.name ?? `${data.format} import`}
                  </p>
                  {data.ofxMeta && hasAnyOfxMeta(data.ofxMeta) && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {ofxSubtitle(data.ofxMeta)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="tabular-nums">{data.total}</span> row
                    {data.total === 1 ? "" : "s"}
                    {(newRowCount > 0 || duplicateCount > 0) && " · "}
                    {newRowCount > 0 && (
                      <span className="text-amber-700 dark:text-amber-300">
                        <span className="font-medium tabular-nums">
                          {newRowCount}
                        </span>{" "}
                        new
                      </span>
                    )}
                    {newRowCount > 0 && duplicateCount > 0 && (
                      <span> · </span>
                    )}
                    {duplicateCount > 0 && (
                      <span className="text-emerald-700 dark:text-emerald-300">
                        <span className="font-medium tabular-nums">
                          {duplicateCount}
                        </span>{" "}
                        duplicate{duplicateCount === 1 ? "" : "s"}
                      </span>
                    )}
                    {hiddenIdenticalCount > 0 && (
                      <span className="text-muted-foreground/60">
                        {" · "}
                        <span className="tabular-nums">
                          {hiddenIdenticalCount}
                        </span>{" "}
                        identical{" "}
                        <button
                          type="button"
                          onClick={() => setShowIdentical((v) => !v)}
                          className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                        >
                          {showIdentical ? "hide" : "show"}
                        </button>
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <SaveLearnedAliases rows={data.rows} />

          <UnresolvedAccountsResolver
            rows={effectiveRows}
            accounts={accounts}
            onResolve={(bankId, account) =>
              setAccountOverrides((prev) => {
                const next = new Map(prev);
                next.set(bankId, {
                  accountId: account.id,
                  accountName: account.name,
                });
                return next;
              })
            }
          />

          {/* Per-account chip row — only meaningful for multi-account
            QIF files. Single-account imports skip this entirely. */}
          {data.qifAccountSummary.length > 1 && (
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setAccountFilter("all")}
                className={cn(
                  "px-2 py-1 rounded border transition-colors",
                  accountFilter === "all"
                    ? "bg-foreground text-background border-foreground"
                    : "bg-background hover:bg-muted",
                )}
              >
                All ({data.total})
              </button>
              {data.qifAccountSummary.map((a) => {
                const rep = data.rows.find(
                  (r) =>
                    (r.qifAccount?.name ?? "") === a.name &&
                    !!r.resolvedAccountName,
                );
                const resolvedName = rep?.resolvedAccountName ?? null;
                return (
                  <button
                    key={a.name}
                    type="button"
                    onClick={() => setAccountFilter(a.name)}
                    className={cn(
                      "px-2 py-1 rounded border transition-colors flex items-center gap-2",
                      accountFilter === a.name
                        ? "bg-foreground text-background border-foreground"
                        : "bg-background hover:bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "font-medium",
                        !resolvedName && "text-muted-foreground/70 italic",
                      )}
                    >
                      {resolvedName ?? a.name}
                    </span>
                    <span className="tabular-nums text-muted-foreground/70">
                      {a.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted text-xs text-muted-foreground border-b">
                      <th className="text-left px-2 py-2 w-8" />
                      <th className="text-left px-3 py-2">Date</th>
                      {showAccountColumn && (
                        <th className="text-left px-3 py-2">Account</th>
                      )}
                      <th className="text-left px-3 py-2">Category</th>
                      <th className="text-left px-3 py-2 w-full">Payee</th>
                      <th className="text-right px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredRows.map((r) => {
                      const key = r.importHash;
                      const isOpen = expandedKey === key;
                      return (
                        <ImportRow
                          key={key}
                          row={r}
                          isOpen={isOpen}
                          onToggle={() =>
                            setExpandedKey(isOpen ? null : key)
                          }
                          showAccountColumn={showAccountColumn}
                          categories={categories}
                          onRuleCreated={(cat) =>
                            handleRuleCreated(r.importHash, cat)
                          }
                        />
                      );
                    })}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={showAccountColumn ? 6 : 5}
                          className="px-3 py-6 text-center text-muted-foreground text-sm"
                        >
                          No rows match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <CommitToDb
            data={data}
            effectiveRows={effectiveRows}
            file={file}
          />
        </>
      )}
    </div>
  );
}

/** True for exact matches whose DB row already has every USER-VISIBLE
 * field the parsed row could backfill. `postedSeq` backfill alone is
 * silent (not shown anywhere) so a row that only diffs on it would
 * look identical to the user — hide those rather than make them
 * tick through 40 phantom rows. */
function isExactNoOp(r: TestResultRow): boolean {
  if (r.matchType !== "exact") return false;
  const typeBackfill =
    r.resolvedType != null && (r.existingType ?? null) === null;
  const balanceBackfill =
    r.runningBalance != null && (r.existingBalance ?? null) === null;
  const categoryBackfill =
    r.categoryId != null && (r.existingCategoryName ?? null) === null;
  return !typeBackfill && !balanceBackfill && !categoryBackfill;
}

function hasAnyOfxMeta(m: OFXMeta): boolean {
  return !!(
    m.institution ||
    m.accountId ||
    m.accountType ||
    m.bankId ||
    m.currency ||
    m.statementStart ||
    m.statementEnd ||
    m.ledgerBalance ||
    m.availableBalance
  );
}

/** OFX header subtitle — institution · BSB · masked-id · ledger
 * balance (as of). Compact one-liner replaces the old 4-column meta
 * card; the full breakdown moved into the expand panel for
 * statement-detail diagnostics. */
function ofxSubtitle(m: OFXMeta): string {
  const parts: string[] = [];
  if (m.institution) parts.push(m.institution);
  if (m.bankId) parts.push(`BSB ${m.bankId}`);
  if (m.accountId) {
    const last4 = m.accountId.length > 4 ? m.accountId.slice(-4) : m.accountId;
    parts.push(`····${last4}`);
  }
  if (m.ledgerBalance) {
    const amt = parseFloat(m.ledgerBalance.amount);
    if (Number.isFinite(amt)) {
      parts.push(
        `ledger ${formatAUD(amt)}${m.ledgerBalance.asOf ? ` (${m.ledgerBalance.asOf})` : ""}`,
      );
    }
  }
  return parts.join(" · ");
}

const ROW_STATE_CLASS = {
  // "New" rows (will INSERT) get the same neutral treatment the
  // live /transactions table uses — no fill, hover-muted — so the
  // import-review reads like the same surface the operator will
  // end up on after commit. "Duplicate" rows keep the green tint;
  // their "already in the DB, nothing to add" state is the
  // important visual signal that warrants a distinct colour.
  new: "hover:bg-muted",
  duplicate:
    "bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/50",
} as const;

/** Single-instance row component for the import-review table.
 * Mirrors the visual rhythm of `transaction-row.tsx`: `px-3 py-2`
 * cells, hover-on-row, click-anywhere-inert-to-toggle-expand,
 * `<Fragment>` so the expand panel becomes a sibling `<tr>` rather
 * than a nested table. Row background communicates state at a
 * glance: muted yellow = new (will insert), muted green = matched
 * (will backfill, won't insert). */
function ImportRow({
  row,
  isOpen,
  onToggle,
  showAccountColumn,
  categories,
  onRuleCreated,
}: {
  row: TestResultRow;
  isOpen: boolean;
  onToggle: () => void;
  showAccountColumn: boolean;
  categories: CategoryOption[];
  onRuleCreated: (cat: CategoryOption) => void;
}) {
  const Chev = isOpen ? ChevronDown : ChevronRight;
  const amt = parseFloat(row.amount);
  const state: "new" | "duplicate" = row.matchType ? "duplicate" : "new";
  const rowStateCls = ROW_STATE_CLASS[state];

  return (
    <>
      <tr
        className={cn("group cursor-pointer", rowStateCls)}
        onClick={(e) => {
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
          onToggle();
        }}
      >
        <td className="px-2 py-2 align-middle text-muted-foreground">
          <Chev className="h-3.5 w-3.5" />
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {row.date}
        </td>
        {showAccountColumn && (
          <td className="px-3 py-2 whitespace-nowrap">
            {row.resolvedAccountName ? (
              <span className="text-xs font-medium">
                {row.resolvedAccountName}
              </span>
            ) : row.qifAccount?.name ? (
              <span className="text-xs text-muted-foreground/70 italic">
                {row.qifAccount.name}
              </span>
            ) : (
              <span className="text-muted-foreground italic text-xs">—</span>
            )}
          </td>
        )}
        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
          <RuleCreator
            normalizedPayee={row.normalizedPayee}
            currentCategoryId={row.categoryId}
            amount={row.amount}
            categories={categories}
            onCreated={onRuleCreated}
          />
        </td>
        <td className="px-3 py-2 w-full max-w-0">
          <span className="font-medium truncate inline-block max-w-full align-middle">
            {row.payee || "—"}
          </span>
        </td>
        <td
          className={cn(
            "px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium",
            amountClass(amt),
          )}
        >
          {formatAUD(amt)}
        </td>
      </tr>
      {isOpen && (
        <tr className={cn("border-b", rowStateCls)}>
          <td />
          <td
            colSpan={showAccountColumn ? 5 : 4}
            className="px-3 py-3 bg-background/60"
          >
            <ImportRowExpanded row={row} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Metadata panel that drops down under a row when clicked. For
 * matched rows: side-by-side diff (existing-DB vs incoming-file)
 * for the user-visible fields plus the bank's running-balance
 * sanity check. For new rows: source-only fields the parser
 * surfaced (rawId, normalizedPayee, splits, address, trnType,
 * bankCategory, checkNum, refNum, cleared, runningBalance) plus
 * trigram diagnostic info (neighbours + category ranges). */
function ImportRowExpanded({ row }: { row: TestResultRow }) {
  const amt = parseFloat(row.amount);
  const matched = !!row.matchType;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {matched ? "Importing (this file)" : "Source data"}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Field label="Date" value={row.date} />
          <Field label="Amount" value={formatAUD(amt)} />
          <Field label="Payee" value={row.payee || "—"} />
          {row.normalizedPayee && row.normalizedPayee !== row.payee && (
            <Field label="Normalised" value={row.normalizedPayee} muted />
          )}
          <Field
            label="Account"
            value={
              row.resolvedAccountName ??
              (row.resolvedAccountVia
                ? `via ${row.resolvedAccountVia}`
                : "unresolved")
            }
            muted={!row.resolvedAccountName}
          />
          {row.qifAccount?.name && (
            <Field label="Bank ID" value={row.qifAccount.name} mono />
          )}
          {row.resolvedType && (
            <Field label="Type" value={row.resolvedType} />
          )}
          {row.trnType && <Field label="Bank type" value={row.trnType} />}
          {row.bankCategory && (
            <Field label="Bank category" value={row.bankCategory} />
          )}
          {row.checkNum && <Field label="Check #" value={row.checkNum} />}
          {row.refNum && <Field label="Ref #" value={row.refNum} />}
          {row.cleared && <Field label="Cleared" value={row.cleared} />}
          {row.runningBalance && (
            <Field
              label="Bal claimed"
              value={
                <span className="inline-flex items-center gap-1">
                  <span className="tabular-nums">
                    {formatAUD(parseFloat(row.runningBalance))}
                  </span>
                  {row.balanceCheck && (
                    <span
                      className={cn(
                        "font-medium",
                        row.balanceCheck.match
                          ? "text-emerald-600"
                          : "text-red-600",
                      )}
                      title={
                        row.balanceCheck.match
                          ? `Predicted ${formatAUD(row.balanceCheck.predicted)} ✓`
                          : `Predicted ${formatAUD(row.balanceCheck.predicted)}; Δ ${formatAUD(row.balanceCheck.delta)}`
                      }
                    >
                      {row.balanceCheck.match ? "✓" : "✗"}
                    </span>
                  )}
                </span>
              }
            />
          )}
          <Field label="Raw ID" value={row.rawId} mono muted />
          <Field label="Hash" value={row.importHash.slice(0, 16) + "…"} mono muted />
        </dl>
        {row.splits && row.splits.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">
              Splits
            </p>
            <ul className="mt-1 space-y-0.5">
              {row.splits.map((s, j) => (
                <li key={j} className="flex gap-3">
                  <span className="w-48 truncate">{s.category ?? "—"}</span>
                  <span className="text-muted-foreground truncate flex-1">
                    {s.memo ?? ""}
                  </span>
                  {s.amount && (
                    <span className="tabular-nums">
                      {formatAUD(parseFloat(s.amount))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {row.address && row.address.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">
              Address
            </p>
            <ul className="mt-1">
              {row.address.map((a, j) => (
                <li key={j}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {matched ? (
          <>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              In DB ({row.matchType})
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Field
                label="Date"
                value={row.existingDate ?? "—"}
                diff={
                  !!row.existingDate &&
                  (row.existingDate ?? "") !== row.date
                }
              />
              <Field
                label="Amount"
                value={
                  row.existingAmount != null &&
                  Number.isFinite(parseFloat(row.existingAmount))
                    ? formatAUD(parseFloat(row.existingAmount))
                    : "—"
                }
                diff={
                  !!row.existingAmount &&
                  (row.existingAmount ?? "") !== row.amount
                }
              />
              <Field
                label="Payee"
                value={row.existingPayee ?? "—"}
                diff={
                  (row.existingPayee ?? "").trim().toUpperCase() !==
                  row.payee.trim().toUpperCase()
                }
              />
              <Field
                label="Account"
                value={row.existingAccountName ?? "—"}
                diff={
                  !!row.resolvedAccountName &&
                  !!row.existingAccountName &&
                  row.resolvedAccountName !== row.existingAccountName
                }
              />
              <Field
                label="Category"
                value={row.existingCategoryName ?? "—"}
                diff={
                  (row.existingCategoryName ?? "") !==
                  (row.categoryName ?? "")
                }
              />
              {(row.existingType || row.resolvedType) && (
                <Field
                  label="Type"
                  value={row.existingType ?? "—"}
                  diff={
                    (row.resolvedType ?? "") !== (row.existingType ?? "") &&
                    !!(row.resolvedType || row.existingType)
                  }
                />
              )}
              {(row.existingBalance || row.runningBalance) && (
                <Field
                  label="Balance"
                  value={
                    row.existingBalance != null
                      ? formatAUD(parseFloat(row.existingBalance))
                      : "—"
                  }
                  diff={
                    !!row.existingBalance &&
                    !!row.runningBalance &&
                    parseFloat(row.existingBalance).toFixed(2) !==
                      parseFloat(row.runningBalance).toFixed(2)
                  }
                />
              )}
            </dl>
            <p className="text-[10px] text-muted-foreground mt-1">
              Highlighted cells will be backfilled on commit. Other
              cells stay as-is.
            </p>
            {row.balanceCheckVsDB && !row.balanceCheckVsDB.match && (
              <p className="text-[10px] text-red-600 dark:text-red-400 mt-1">
                ✗ DB balance chain says{" "}
                <span className="tabular-nums font-medium">
                  {formatAUD(row.balanceCheckVsDB.expected)}
                </span>{" "}
                here, file says{" "}
                <span className="tabular-nums font-medium">
                  {formatAUD(row.balanceCheckVsDB.claimed)}
                </span>{" "}
                (Δ {formatAUD(row.balanceCheckVsDB.delta)}). The
                existing posted_seq order is wrong; committing will
                rewrite it.
              </p>
            )}
            {row.balanceCheckVsDB && row.balanceCheckVsDB.match && (
              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-1">
                ✓ DB balance chain agrees with the file at this row.
              </p>
            )}
          </>
        ) : (
          <>
            {row.categoryRanges && row.categoryRanges.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Categories in matched neighbourhood
                </p>
                <ul className="mt-1 space-y-0.5">
                  {row.categoryRanges.map((cr, j) => (
                    <li
                      key={j}
                      className={cn(
                        "flex gap-3 items-center",
                        cr.isPicked && "font-medium",
                      )}
                    >
                      <span className="text-muted-foreground w-12 text-right tabular-nums">
                        {cr.support}n
                      </span>
                      <span className="w-48 truncate">
                        {cr.categoryName ?? "—"}
                        {cr.isPicked && (
                          <span className="ml-1 text-[10px] text-emerald-600">
                            ◀ picked
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {cr.minAmount === cr.maxAmount
                          ? formatAUD(cr.minAmount)
                          : `${formatAUD(cr.minAmount)} – ${formatAUD(cr.maxAmount)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {row.neighbours && row.neighbours.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">
                  Nearest neighbours
                </p>
                <ul className="mt-1 space-y-0.5">
                  {row.neighbours.map((n, j) => (
                    <li key={j} className="flex gap-3">
                      <span className="tabular-nums text-muted-foreground w-10">
                        {(n.similarity * 100).toFixed(0)}%
                      </span>
                      <span
                        className="font-mono text-[11px] truncate max-w-[240px]"
                        title={n.normalizedPayee}
                      >
                        {n.normalizedPayee}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatAUD(n.amount)}
                      </span>
                      <span>{n.categoryName ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(!row.categoryRanges || row.categoryRanges.length === 0) &&
              (!row.neighbours || row.neighbours.length === 0) && (
                <p className="text-[10px] text-muted-foreground italic">
                  No trigram neighbours — categorise this row manually
                  using the picker on the left.
                </p>
              )}
          </>
        )}
      </div>
    </div>
  );
}

/** Inline key/value cell pair. `diff` tints the value amber to flag
 * a backfillable difference in the matched-row diff panel. */
function Field({
  label,
  value,
  diff,
  muted,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  diff?: boolean;
  muted?: boolean;
  mono?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          mono && "font-mono text-[11px]",
          muted && "text-muted-foreground",
          diff && "text-amber-700 dark:text-amber-300",
          !mono && !muted && !diff && "font-medium",
        )}
      >
        {value}
      </dd>
    </>
  );
}

/** Bottom action bar. Commits the current parse to the DB; surfaces
 * an inline breakdown of new vs. backfill vs. identical so the
 * operator knows what's about to happen before clicking. Same logic
 * as before — just trimmed copy. */
function CommitToDb({
  data,
  effectiveRows,
  file,
}: {
  data: TestResponse;
  effectiveRows: TestResultRow[];
  file: File | null;
}) {
  const router = useRouter();
  const [committing, setCommitting] = useState(false);
  const confirm = useConfirm();

  const committableRows = useMemo(
    () => effectiveRows.filter((r) => !!r.resolvedAccountId),
    [effectiveRows],
  );
  const unresolved = useMemo(
    () => effectiveRows.filter((r) => !r.resolvedAccountId).length,
    [effectiveRows],
  );
  const newCount = committableRows.filter((r) => !r.matchType).length;
  const exactBackfillCount = committableRows.filter(
    (r) => r.matchType === "exact" && !isExactNoOp(r),
  ).length;
  const exactNoOpCount = committableRows.filter(
    (r) => r.matchType === "exact" && isExactNoOp(r),
  ).length;
  const legacyCount = committableRows.filter(
    (r) => r.matchType === "legacy",
  ).length;
  const possibleCount = committableRows.filter(
    (r) => r.matchType === "possible",
  ).length;
  // Rows whose existing DB balance disagrees with the chain-predicted
  // value. Commit-batched re-derives intra-day order from stored
  // balances for the affected (account, date) groups; even when
  // there's nothing to insert and nothing to backfill, this count
  // alone makes the commit worth running.
  const chainMismatchCount = committableRows.filter(
    (r) => r.balanceCheckVsDB && !r.balanceCheckVsDB.match,
  ).length;
  const willChangeCount =
    newCount + exactBackfillCount + legacyCount + possibleCount;
  const hasWork = willChangeCount > 0 || chainMismatchCount > 0;

  async function commit() {
    if (committableRows.length === 0 || !file) return;

    const accountIds = Array.from(
      new Set(
        committableRows
          .map((r) => r.resolvedAccountId)
          .filter((id): id is string => !!id),
      ),
    );
    if (accountIds.length > 0) {
      const checkRes = await fetch("/api/import/format-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: data.format, accountIds }),
      });
      if (checkRes.ok) {
        const { newFormatAccounts } = (await checkRes.json()) as {
          newFormatAccounts: {
            accountId: string;
            name: string;
            priorFormats: string[];
          }[];
        };
        if (newFormatAccounts.length > 0) {
          const formatLabel = data.format.toUpperCase();
          const lines = newFormatAccounts.map((a) => {
            const prior =
              a.priorFormats.length > 0
                ? `previously ${a.priorFormats.map((f) => f.toUpperCase()).join(", ")}`
                : "no prior imports";
            return `• ${a.name} — ${prior}`;
          });
          const ok = await confirm({
            title: `First ${formatLabel} import for ${
              newFormatAccounts.length === 1
                ? "this account"
                : `${newFormatAccounts.length} accounts`
            }`,
            description: `${formatLabel} hashes don't line up with other formats, so re-importing the same statement in a different format will create duplicates instead of matching.\n\n${lines.join("\n")}\n\nProceed anyway?`,
            confirmLabel: `Import ${formatLabel}`,
          });
          if (!ok) return;
        }
      }
    }

    setCommitting(true);
    try {
      const payload = {
        filename: file.name,
        format: data.format,
        rows: committableRows.map((r) => ({
          accountId: r.resolvedAccountId!,
          date: r.date,
          amount: r.amount,
          payee: r.payee,
          description: r.payee,
          importHash: r.importHash,
          rawId: r.rawId,
          categoryId: r.categoryId ?? null,
          type: r.resolvedType ?? null,
          balance: r.runningBalance ?? null,
          // Send the parser-computed posted_seq through to the
          // commit endpoint — without this, commit-batched inserts
          // NULL, the running-balance SQL falls through to
          // created_at|id ordering (= file insert order), and
          // newest-first CSVs end up with same-day rows reversed
          // in the DB even though the parser had the right answer.
          postedSeq: r.postedSeq ?? null,
          bankAccountId: r.qifAccount?.name ?? null,
        })),
      };
      const res = await fetch("/api/import/commit-batched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const { error } = await res
          .json()
          .catch(() => ({ error: "Commit failed" }));
        toast.error(error ?? "Commit failed");
        return;
      }
      const result = await res.json();
      const updatePieces: string[] = [];
      if (result.migratedHashes)
        updatePieces.push(`${result.migratedHashes} hashes migrated`);
      if (result.backfilledType)
        updatePieces.push(`${result.backfilledType} types filled`);
      if (result.backfilledBalance)
        updatePieces.push(`${result.backfilledBalance} balances filled`);
      if (result.backfilledCategory)
        updatePieces.push(`${result.backfilledCategory} categories filled`);
      if (result.backfilledPostedSeq)
        updatePieces.push(`${result.backfilledPostedSeq} sequences filled`);
      if (result.correctedPostedSeq)
        updatePieces.push(`${result.correctedPostedSeq} sequences re-ordered`);
      const updateText =
        updatePieces.length > 0 ? ` · ${updatePieces.join(" · ")}` : "";
      if (result.imported > 0) {
        toast.success(
          `Imported ${result.imported} new transactions across ${result.accountsTouched} account${result.accountsTouched === 1 ? "" : "s"}${updateText}`,
        );
      } else if (updatePieces.length > 0) {
        toast.success(`Updated existing rows: ${updatePieces.join(" · ")}`);
      } else {
        toast.success(
          `Nothing to update — ${result.skippedDuplicate} duplicate${result.skippedDuplicate === 1 ? "" : "s"} already in sync.`,
        );
      }
      // Auto-pairing summary: the commit endpoint runs the matcher
      // after insert. Surfacing this here makes the behaviour
      // visible — the operator imports a CSV and immediately sees
      // "+ N transfers paired" instead of wondering why a transfer
      // they expected isn't linked.
      const paired = typeof result.transfersPaired === "number" ? result.transfersPaired : 0;
      const suggested = typeof result.transfersSuggested === "number" ? result.transfersSuggested : 0;
      if (paired > 0 || suggested > 0) {
        const pieces: string[] = [];
        if (paired > 0) pieces.push(`${paired} transfer${paired === 1 ? "" : "s"} auto-paired`);
        if (suggested > 0) pieces.push(`${suggested} suggestion${suggested === 1 ? "" : "s"} surfaced`);
        toast.success(pieces.join(" · "));
      }
      // Hand the just-committed importLogIds to the transactions
      // page so an Undo affordance can sit in its topbar (next to
      // the Import button). Then redirect — the import-review page
      // has done its job; the operator wants to see the rows they
      // just landed.
      if (result.imported > 0 && Array.isArray(result.importLogIds)) {
        stashPendingUndoImport({
          importLogIds: result.importLogIds,
          imported: result.imported,
          accountsTouched: result.accountsTouched ?? 0,
          committedAt: Date.now(),
        });
      }
      router.push("/transactions");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Ready to commit</p>
            <p className="text-xs text-muted-foreground">
              {newCount} new ·{" "}
              {exactBackfillCount + legacyCount + possibleCount} duplicate
              {exactBackfillCount + legacyCount + possibleCount === 1
                ? ""
                : "s"}{" "}
              to backfill
              {exactNoOpCount > 0 &&
                ` · ${exactNoOpCount} identical (no change)`}
              {chainMismatchCount > 0 &&
                ` · ${chainMismatchCount} balance-chain mismatch${chainMismatchCount === 1 ? "" : "es"} to fix`}
              .
            </p>
            {unresolved > 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                {unresolved} row{unresolved === 1 ? " has" : "s have"} no
                resolved account — won&rsquo;t be committed.
              </p>
            )}
          </div>
          <Button
            onClick={commit}
            disabled={
              committing ||
              committableRows.length === 0 ||
              !file ||
              !hasWork
            }
            title={
              committableRows.length === 0
                ? "No committable rows"
                : !hasWork
                  ? "Every row is already in the DB and the balance chain is fine — nothing to do."
                  : undefined
            }
          >
            {committing
              ? "Committing…"
              : !hasWork
                ? "Nothing to commit"
                : newCount > 0
                  ? `Commit ${willChangeCount} row${willChangeCount === 1 ? "" : "s"}`
                  : willChangeCount > 0
                    ? `Update ${willChangeCount}`
                    : `Fix ${chainMismatchCount} balance mismatch${chainMismatchCount === 1 ? "" : "es"}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SaveLearnedAliases({ rows }: { rows: TestResultRow[] }) {
  const [saving, setSaving] = useState(false);
  const candidates = useMemo(() => {
    const byKey = new Map<
      string,
      { value: string; accountId: string; accountName: string; rowCount: number }
    >();
    for (const r of rows) {
      if (r.resolvedAccountVia !== "heuristic-match") continue;
      if (
        !r.qifAccount?.name ||
        !r.resolvedAccountId ||
        !r.resolvedAccountName
      )
        continue;
      const key = r.qifAccount.name;
      const cur = byKey.get(key);
      if (cur) cur.rowCount += 1;
      else
        byKey.set(key, {
          value: key,
          accountId: r.resolvedAccountId,
          accountName: r.resolvedAccountName,
          rowCount: 1,
        });
    }
    return Array.from(byKey.values());
  }, [rows]);

  if (candidates.length === 0) return null;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/import/learn-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aliases: candidates.map((c) => ({
            kind: "bank-account",
            value: c.value,
            accountId: c.accountId,
          })),
        }),
      });
      if (!res.ok) {
        const { error } = await res
          .json()
          .catch(() => ({ error: "Save failed" }));
        toast.error(error ?? "Save failed");
      } else {
        const { saved } = await res.json();
        toast.success(
          `Saved ${saved} alias${saved === 1 ? "" : "es"}. Re-run to see them resolve via "alias".`,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-3 pb-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Learned account mappings (heuristic)
        </p>
        <ul className="text-xs space-y-0.5">
          {candidates.map((c) => (
            <li key={c.value} className="flex gap-3">
              <span className="font-mono">{c.value}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium">{c.accountName}</span>
              <span className="text-muted-foreground tabular-nums">
                {c.rowCount} rows
              </span>
            </li>
          ))}
        </ul>
        <Button size="sm" variant="outline" onClick={save} disabled={saving}>
          {saving
            ? "Saving…"
            : `Save ${candidates.length} alias${candidates.length === 1 ? "" : "es"}`}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Surfaces rows whose source bank-account-id didn't resolve to any
 *  app account (no alias, no last-4 match, no heuristic hit). For
 *  each such bank-id, the operator can either pick an existing
 *  account or pop the Add-Account dialog with the bank-id prefilled.
 *  Resolutions persist as bank-account aliases so the same CSV
 *  re-imports auto-resolve next time. */
function UnresolvedAccountsResolver({
  rows,
  accounts,
  onResolve,
}: {
  rows: TestResultRow[];
  accounts: AccountOption[];
  onResolve: (bankId: string, account: AccountOption) => void;
}) {
  const addAccount = useAddAccount();
  // Group unresolved rows by bank-id. Rows without a bank-id share
  // the synthetic key "" so they all resolve in one shot.
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (r.resolvedAccountId) continue;
      const key = r.qifAccount?.name ?? "";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [rows]);

  if (groups.length === 0) return null;

  async function persistAlias(bankId: string, accountId: string) {
    if (!bankId) return;
    try {
      await fetch("/api/import/learn-aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aliases: [{ kind: "bank-account", value: bankId, accountId }],
        }),
      });
    } catch {
      // Best-effort — the row override still applies locally even if
      // alias persistence fails; the user just won't get auto-resolve
      // on the next import of the same file.
    }
  }

  function applyExisting(bankId: string, accountId: string) {
    const acct = accounts.find((a) => a.id === accountId);
    if (!acct) return;
    onResolve(bankId, acct);
    void persistAlias(bankId, acct.id);
    toast.success(
      `${bankId ? `"${bankId}"` : "Unidentified rows"} → ${acct.name}`,
    );
  }

  function applyCreated(bankId: string, account: AccountOption) {
    onResolve(bankId, account);
    void persistAlias(bankId, account.id);
    toast.success(
      `${bankId ? `"${bankId}"` : "Unidentified rows"} → ${account.name}`,
    );
  }

  return (
    <Card>
      <CardContent className="pt-3 pb-3 space-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Unresolved accounts
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            These rows&rsquo; source account didn&rsquo;t match any of your
            accounts by alias or last-4 digits. Pick or create one — the
            choice is saved as an alias so the next import auto-resolves.
          </p>
        </div>
        <ul className="space-y-2">
          {groups.map(([bankId, count]) => {
            const last4 = (bankId.match(/(\d{4})\D*$/)?.[1]) ?? "";
            return (
              <li
                key={bankId}
                className="flex flex-wrap items-center gap-2 text-xs"
              >
                <span className="font-mono shrink-0">
                  {bankId || "(no bank id)"}
                </span>
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {count} row{count === 1 ? "" : "s"}
                </span>
                <span className="text-muted-foreground shrink-0">→</span>
                <SearchableCombobox
                  value=""
                  onChange={(id) => applyExisting(bankId, id)}
                  items={accounts.map((a) => ({
                    id: a.id,
                    label: a.name,
                    ancestors: a.accountNumberLast4
                      ? [`••${a.accountNumberLast4}`]
                      : undefined,
                  }))}
                  placeholder="Pick account…"
                  emptyTriggerLabel="Pick account…"
                  searchPlaceholder="Search accounts…"
                  emptyMessage="No accounts."
                  onCreate={{
                    onSelect: (name) =>
                      addAccount.open({
                        name,
                        accountNumberLast4: last4,
                        onCreated: (acct) =>
                          applyCreated(bankId, acct as AccountOption),
                      }),
                  }}
                  triggerClassName="h-7 text-xs px-2 border rounded-md bg-background inline-flex items-center justify-between gap-2 min-w-[200px]"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    addAccount.open({
                      name: bankId,
                      accountNumberLast4: last4,
                      onCreated: (acct) =>
                        applyCreated(bankId, acct as AccountOption),
                    })
                  }
                >
                  + New
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Inline category picker. When the row already has a (suggested)
 * category, the trigger shows it and picking another value POSTs an
 * override rule. For uncategorised rows the trigger shows the
 * placeholder. Either way the change creates a payee_rule so future
 * imports auto-classify. */
function RuleCreator({
  normalizedPayee,
  currentCategoryId,
  amount,
  categories,
  onCreated,
}: {
  normalizedPayee: string;
  currentCategoryId: string | null;
  amount?: string;
  categories: CategoryOption[];
  onCreated: (cat: CategoryOption) => void;
}) {
  const [saving, setSaving] = useState(false);

  // The "Create new category" flow inside the picker captures THIS
  // render's `onChange` closure, which closes over THIS render's
  // `categories` prop. By the time onChange fires (after the user
  // submits the Add-Category dialog), the parent has SWR-refetched
  // and a fresher categories list is in scope — but the captured
  // closure still references the stale prop. A ref synced inline
  // gives the captured handleChange a path back to the freshest
  // list at call time.
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;

  async function handleChange(catId: string) {
    if (!catId) return;
    if (catId === currentCategoryId) return;
    const cat = categoriesRef.current.find((c) => c.id === catId);
    if (!cat) return;
    setSaving(true);
    try {
      const res = await fetch("/api/payee-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          normalizedPayee,
          categoryId: catId,
          amount,
          currentCategoryId,
        }),
      });
      if (!res.ok) {
        const { error } = await res
          .json()
          .catch(() => ({ error: "Save failed" }));
        toast.error(error ?? "Save failed");
        return;
      }
      const json = await res.json();
      onCreated(cat);
      if (json.deleted) {
        toast.success(
          `Rule removed — trigram already picks ${cat.name} for "${normalizedPayee}"`,
        );
      } else if (json.noop) {
        toast.success(
          json.reason === "trigram-suffices"
            ? `${cat.name} — trigram already gets it; no rule needed`
            : `${cat.name}`,
        );
      } else if (json.updated) {
        toast.success(`Rule updated — ${normalizedPayee} → ${cat.name}`);
      } else {
        toast.success(
          `Rule created — future imports of "${normalizedPayee}" will categorise as ${cat.name}`,
        );
      }
    } finally {
      setSaving(false);
    }
  }

  // No category picked + the row is fillable (has a normalised
  // payee) ⇒ tint the dropdown trigger indigo so the operator's
  // eye lands on the rows that still need attention. Once a
  // category is picked the tint clears.
  const needsAction = !currentCategoryId && !!normalizedPayee && !saving;
  return (
    // `<div>` rather than `<span onClick>` — the onClick here is a
    // pure event-bubble suppressor (the inner CategoryDropdown owns
    // its own interaction), so we want non-interactive semantics +
    // no implicit role/keyboard expectation from a click handler on
    // a span.
    <div onClick={(e) => e.stopPropagation()}>
      <CategoryDropdown
        value={currentCategoryId}
        onChange={(v) => handleChange(v ?? "")}
        categories={categories}
        disabled={saving || categories.length === 0 || !normalizedPayee}
        placeholder={saving ? "Saving…" : "Set category…"}
        triggerClassName={cn(
          "py-0 min-w-[160px]",
          needsAction &&
            "bg-indigo-500/30 border-indigo-500/70 text-indigo-800 dark:text-indigo-100 hover:bg-indigo-500/40 dark:bg-indigo-500/40 dark:border-indigo-400",
        )}
        uncategorisedLabel={null}
      />
    </div>
  );
}
