"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { formatAUD, amountClass, cn } from "@/lib/utils";

interface CategoryOption {
  id: string;
  name: string;
  parentId: string | null;
  type: "income" | "expense" | string;
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
  /** Stable per-row identifier echoed by the endpoint — used as the key
   * for client-side category-rule overrides so an override survives
   * filter/sort changes. */
  importHash: string;
  /** Format-aware raw id from the parser (e.g. "csv-…", "qif-…",
   * "ofx-FITID-…"). Sent to the commit-batched endpoint verbatim so the
   * server-side hash matches what the tester surfaced. */
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
  resolvedType?: string | null;
  resolvedAccountId?: string | null;
  resolvedAccountName?: string | null;
  resolvedAccountVia?: "alias" | "last4" | "heuristic-match" | null;
  // Format-specific extras
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

const METHOD_BADGE: Record<TestResultRow["method"], { label: string; className: string }> = {
  rule: { label: "rule", className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300" },
  trigram: { label: "trigram", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  none: { label: "none", className: "bg-muted text-muted-foreground" },
};

export function ImportView() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TestResponse | null>(null);
  const [methodFilter, setMethodFilter] = useState<TestResultRow["method"] | "all">("all");
  const [accountFilter, setAccountFilter] = useState<string | "all">("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  // Categories list for the inline picker on uncategorised rows. Loaded
  // once on first render — small set, no need for SWR.
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  // Locally optimistic overrides applied after the user creates a rule —
  // keyed by importHash. Lets the chip flip from "none" to "rule" and the
  // category appear without re-running the whole test.
  const [localOverrides, setLocalOverrides] = useState<
    Map<string, { categoryId: string; categoryName: string }>
  >(new Map());
  useEffect(() => {
    // Load every category — income + expense. A credit/deposit row needs
    // an income category, otherwise the picker's label lookup fails and
    // base-ui falls back to showing the raw UUID in the trigger.
    fetch("/api/categories")
      .then((r) => r.json())
      .then((cats: CategoryOption[]) => setCategories(cats))
      .catch(() => {});
  }, []);
  // Stage toggles — flip a stage off to see what its absence does.
  // The most useful is "Use rules" off, which forces every row through
  // the trigram suggester so you can see how the new engine performs
  // without the legacy payee_rules overriding.
  const [useRules, setUseRules] = useState(true);
  const [useTrigram, setUseTrigram] = useState(true);
  // Hold on to the last uploaded file so the stage toggles can re-run
  // categorisation against it without making the user drop it again.
  const [file, setFile] = useState<File | null>(null);

  const runCategorise = useCallback(
    async (target: File, opts: { useRules: boolean; useTrigram: boolean }) => {
      setLoading(true);
      setExpanded(new Set());
      const fd = new FormData();
      fd.append("file", target);
      fd.append("useRules", String(opts.useRules));
      fd.append("useTrigram", String(opts.useTrigram));
      const res = await fetch("/api/import/categorise", { method: "POST", body: fd });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Categorisation failed" }));
        toast.error(error ?? "Categorisation failed");
        setLoading(false);
        return;
      }
      const json: TestResponse = await res.json();
      setData(json);
      setAccountFilter("all");
      setLoading(false);
    },
    [],
  );

  const onDrop = useCallback(
    async (files: File[]) => {
      const f = files[0];
      if (!f) return;
      setFile(f);
      setData(null);
      await runCategorise(f, { useRules, useTrigram });
    },
    [runCategorise, useRules, useTrigram],
  );

  // First-time-format guard. Fires once the parse has produced a format
  // and runs BEFORE the user can map accounts or commit, so a wrong
  // format pick is caught up-front. The hook clears the picked file on
  // cancel so the rest of the import UI doesn't activate.
  const promptedFormatRef = useRef<string | null>(null);
  const confirmFn = useConfirm();
  const fileNameForPrompt = file?.name ?? null;
  useEffect(() => {
    const fmt = data?.format;
    if (!fmt) return;
    // Already prompted for this format in this session — don't bug the
    // user a second time on stage-toggle re-runs.
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
      // Sorted descending by row count so the dominant format appears
      // first ("OFX: 1,567 · CSV: 123 · QIF: 0").
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
        // User backed out — discard the parse so the mapping/commit UI
        // doesn't activate.
        setFile(null);
        setData(null);
        promptedFormatRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data?.format, fileNameForPrompt, confirmFn]);

  const toggleStage = useCallback(
    async (stage: "rules" | "trigram", next: boolean) => {
      const opts = { useRules, useTrigram };
      if (stage === "rules") {
        setUseRules(next);
        opts.useRules = next;
      }
      if (stage === "trigram") {
        setUseTrigram(next);
        opts.useTrigram = next;
      }
      if (file) await runCategorise(file, opts);
    },
    [file, runCategorise, useRules, useTrigram],
  );

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

  // Default-hide exact-match rows that the commit would do nothing for
  // (no missing type/balance/category in the DB row to backfill). Exact
  // rows that ARE going to update something stay visible. Toggle
  // reveals the truly-no-op rows on demand.
  const [showAllMatched, setShowAllMatched] = useState(false);
  // Local-override application: when the user assigns a rule via the
  // inline picker, flip the row's method/category in-memory so it
  // reclassifies without re-running the whole test.
  const effectiveRows = useMemo(() => {
    return (data?.rows ?? []).map((r) => {
      const o = localOverrides.get(r.importHash);
      if (!o) return r;
      return {
        ...r,
        method: "rule" as const,
        categoryId: o.categoryId,
        categoryName: o.categoryName,
        score: undefined,
        support: undefined,
      } satisfies TestResultRow;
    });
  }, [data?.rows, localOverrides]);
  const filteredRows = effectiveRows.filter((r) => {
    if (methodFilter !== "all" && r.method !== methodFilter) return false;
    if (accountFilter !== "all" && (r.qifAccount?.name ?? "") !== accountFilter) return false;
    if (!showAllMatched && isExactNoOp(r)) return false;
    return true;
  });
  const hiddenNoOpCount = effectiveRows.filter(isExactNoOp).length;
  function handleRuleCreated(importHash: string, cat: CategoryOption) {
    setLocalOverrides((prev) => {
      const next = new Map(prev);
      next.set(importHash, { categoryId: cat.id, categoryName: cat.name });
      return next;
    });
  }
  // Multi-account QIFs get a dedicated Account column + clickable summary
  // entries; single-account QIFs (and OFX/CSV) keep the existing layout.
  const showAccountColumn = (data?.qifAccountSummary.length ?? 0) >= 2;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            Drop a bank export (CSV, OFX, QFX, or QIF) to import. Each row
            is auto-routed to the right account, dedup&rsquo;d against the
            existing DB, and categorised via explicit rules then trigram
            similarity against your transaction history. Cross-format
            duplicates (e.g. a CSV row that matches an existing OFX
            record) get matched, hash-migrated, and have their
            type&nbsp;/&nbsp;balance fields backfilled rather than
            re-inserted. Review the per-row diff, override categories
            inline, then click Commit at the bottom.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-muted-foreground">Pipeline:</span>
            {(
              [
                {
                  stage: "rules" as const,
                  on: useRules,
                  label: "Use payee_rules",
                  hint: "the existing override layer",
                },
                {
                  stage: "trigram" as const,
                  on: useTrigram,
                  label: "Use trigram",
                  hint: "history-similarity suggester",
                },
              ]
            ).map(({ stage, on, label, hint }) => (
              <label
                key={stage}
                className={cn(
                  "flex items-center gap-1.5 cursor-pointer select-none",
                  loading && "opacity-50",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={loading}
                  onChange={(e) => toggleStage(stage, e.target.checked)}
                  className="cursor-pointer accent-indigo-600"
                />
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground">— {hint}</span>
              </label>
            ))}
          </div>
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors",
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
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 flex-wrap">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {data.total} rows · format {data.format}
                </span>
                <span className="ml-auto flex gap-2 flex-wrap items-center">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showAllMatched}
                      onChange={(e) => setShowAllMatched(e.target.checked)}
                      className="cursor-pointer accent-indigo-600"
                    />
                    <span>
                      Show identical rows
                      {hiddenNoOpCount > 0 && !showAllMatched && (
                        <span className="text-muted-foreground/80">
                          {" "}
                          ({hiddenNoOpCount.toLocaleString()} hidden, commit
                          would skip)
                        </span>
                      )}
                    </span>
                  </label>
                  {(["all", "rule", "trigram", "none"] as const).map((m) => {
                    const count =
                      m === "all" ? data.total : data.summary[m as keyof typeof data.summary];
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMethodFilter(m)}
                        className={cn(
                          "text-xs px-2 py-1 rounded border transition-colors",
                          methodFilter === m
                            ? "bg-foreground text-background border-foreground"
                            : "bg-background hover:bg-muted",
                        )}
                      >
                        {m}: {count}
                      </button>
                    );
                  })}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Existing-record match summary. Three confidence tiers:
              - exact: importHash already in DB (production import would skip)
              - legacy: pre-rawId hash form matches
              - possible: same date+amount in DB but hashes differ — usually
                a different format originally imported the same statement
                (production import will NOT skip these). */}
          {data.matchSummary && (
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-muted-foreground uppercase tracking-wider">
                    Existing-record match
                  </span>
                  <span>
                    <span className="font-medium tabular-nums">{data.matchSummary.newRows}</span>{" "}
                    <span className="text-muted-foreground">new</span>
                  </span>
                  <span className="text-emerald-600">
                    <span className="font-medium tabular-nums">{data.matchSummary.exact}</span>{" "}
                    exact
                  </span>
                  {data.matchSummary.legacy > 0 && (
                    <span className="text-amber-600">
                      <span className="font-medium tabular-nums">{data.matchSummary.legacy}</span>{" "}
                      legacy hash
                    </span>
                  )}
                  {data.matchSummary.possible > 0 && (
                    <span className="text-orange-600">
                      <span className="font-medium tabular-nums">{data.matchSummary.possible}</span>{" "}
                      possible (date+amount, different format)
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* OFX statement-level meta */}
          {data.ofxMeta && hasAnyOfxMeta(data.ofxMeta) && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  OFX statement
                </p>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <MetaField label="Institution" value={data.ofxMeta.institution} />
                  <MetaField label="Account ID" value={data.ofxMeta.accountId} />
                  <MetaField label="Account type" value={data.ofxMeta.accountType} />
                  <MetaField label="Bank ID (BSB)" value={data.ofxMeta.bankId} />
                  <MetaField label="Currency" value={data.ofxMeta.currency} />
                  <MetaField
                    label="Statement period"
                    value={
                      data.ofxMeta.statementStart && data.ofxMeta.statementEnd
                        ? `${data.ofxMeta.statementStart} → ${data.ofxMeta.statementEnd}`
                        : data.ofxMeta.statementStart ?? data.ofxMeta.statementEnd
                    }
                  />
                  <MetaField
                    label="Ledger balance"
                    value={
                      data.ofxMeta.ledgerBalance
                        ? `${formatAUD(parseFloat(data.ofxMeta.ledgerBalance.amount))}${data.ofxMeta.ledgerBalance.asOf ? ` (as of ${data.ofxMeta.ledgerBalance.asOf})` : ""}`
                        : undefined
                    }
                  />
                  <MetaField
                    label="Available balance"
                    value={
                      data.ofxMeta.availableBalance
                        ? formatAUD(parseFloat(data.ofxMeta.availableBalance.amount))
                        : undefined
                    }
                  />
                </dl>
              </CardContent>
            </Card>
          )}

          {/* Heuristic-match alias save: when rows resolved via the
              date+amount heuristic AND we have a bank-account-id from
              the file, the user can persist (bank-account, accountId)
              into account_aliases so future imports auto-route. */}
          <SaveLearnedAliases rows={data.rows} />

          {/* Account summary — click an account to filter the rows table.
              "All accounts" resets. Populated for QIF (!Account blocks) and
              CSV (Bank Account column). The bank-supplied id is what the
              file actually contains; the resolved DB account name comes
              from the per-row resolver, displayed alongside so the user
              can see at a glance which app-account each id maps to. */}
          {data.qifAccountSummary.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Accounts in this file
                </p>
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
                    All accounts ({data.total})
                  </button>
                  {data.qifAccountSummary.map((a) => {
                    const rep = data.rows.find(
                      (r) =>
                        (r.qifAccount?.name ?? "") === a.name &&
                        !!r.resolvedAccountName,
                    );
                    const resolvedName = rep?.resolvedAccountName ?? null;
                    const resolvedVia = rep?.resolvedAccountVia ?? null;
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
                        <span className="flex flex-col items-start leading-tight">
                          <span
                            className={cn(
                              "font-medium",
                              !resolvedName && "text-muted-foreground/70 italic",
                            )}
                          >
                            {resolvedName ?? "unresolved"}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground/70">
                            {a.name}
                            {resolvedVia && (
                              <span className="ml-1 not-italic">via {resolvedVia}</span>
                            )}
                          </span>
                        </span>
                        {a.type && (
                          <span className="text-muted-foreground/70 text-[10px]">{a.type}</span>
                        )}
                        <span className="tabular-nums text-muted-foreground/70">
                          {a.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Field-richness stats — what each format actually carries */}
          {hasAnyFieldStats(data.fieldStats) && (
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  Extra fields populated
                </p>
                <ul className="text-xs grid grid-cols-2 md:grid-cols-3 gap-1.5">
                  <FieldStat label="Bank category" count={data.fieldStats.withBankCategory} total={data.total} />
                  <FieldStat label="Cleared status" count={data.fieldStats.withCleared} total={data.total} />
                  <FieldStat label="Check / ref" count={data.fieldStats.withCheckNum} total={data.total} />
                  <FieldStat label="Splits" count={data.fieldStats.withSplits} total={data.total} />
                  <FieldStat label="Transaction type" count={data.fieldStats.withTrnType} total={data.total} />
                  <FieldStat label="Reference / serial" count={data.fieldStats.withRefNum} total={data.total} />
                  <FieldStat label="Running balance" count={data.fieldStats.withRunningBalance} total={data.total} />
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-muted text-xs text-muted-foreground border-b">
                      <th className="text-left px-3 py-2 w-8" />
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-right px-3 py-2">Amount</th>
                      {showAccountColumn && (
                        <th className="text-left px-3 py-2">Account</th>
                      )}
                      <th className="text-left px-3 py-2 w-full">Payee</th>
                      <th className="text-left px-3 py-2">Category</th>
                      <th className="text-left px-3 py-2">Method</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredRows.map((r, i) => {
                      const idx = data.rows.indexOf(r);
                      const isOpen = expanded.has(idx);
                      const canExpand =
                        (r.method === "trigram" && (r.neighbours?.length ?? 0) > 0) ||
                        (r.splits?.length ?? 0) > 0 ||
                        (r.address?.length ?? 0) > 0;
                      const onToggle = () => {
                        const next = new Set(expanded);
                        if (next.has(idx)) next.delete(idx);
                        else next.add(idx);
                        setExpanded(next);
                      };
                      // Matched rows render side-by-side; everything else
                      // keeps the standard table-row layout.
                      if (r.matchType) {
                        return (
                          <ComparisonRow
                            key={`${idx}-${i}`}
                            row={r}
                            showAccountColumn={showAccountColumn}
                            totalCols={showAccountColumn ? 7 : 6}
                            canExpand={canExpand}
                            isOpen={isOpen}
                            onToggle={onToggle}
                            categories={categories}
                            onRuleCreated={(cat) => handleRuleCreated(r.importHash, cat)}
                          />
                        );
                      }
                      return (
                        <RowGroup
                          key={`${idx}-${i}`}
                          row={r}
                          isOpen={isOpen}
                          canExpand={canExpand}
                          showAccountColumn={showAccountColumn}
                          onToggle={onToggle}
                          categories={categories}
                          onRuleCreated={(cat) => handleRuleCreated(r.importHash, cat)}
                        />
                      );
                    })}
                    {filteredRows.length === 0 && (
                      <tr>
                        <td colSpan={showAccountColumn ? 7 : 6} className="px-3 py-6 text-center text-muted-foreground text-sm">
                          No rows match this filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <CommitToDb data={data} effectiveRows={effectiveRows} file={file} />
        </>
      )}
    </div>
  );
}

/** True for exact matches whose DB row already has every USER-VISIBLE
 * field the parsed row could backfill — committing may still patch
 * `postedSeq` silently but we don't surface those rows for review.
 *
 * Why postedSeq is excluded: it's an OFX intra-day ordering tiebreaker
 * we never render in the comparison view or the transactions list, so
 * a row whose only "diff" is postedSeq looks visually identical to the
 * user. Older commit paths didn't persist it; flagging every legacy
 * OFX re-import as "needs update" with nothing visibly different is
 * just noise. The commit endpoint still does the backfill when the
 * user clicks Commit — they just don't have to review 40 phantom rows. */
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

/** Bottom-of-page action panel that commits the current parse result to
 * the DB. Disabled until the user toggles "Allow DB writes" on. Groups
 * rows by their resolvedAccountId and POSTs to /api/import/commit-batched
 * which creates one importLog per account and inserts the non-duplicate
 * rows. Surfaces a breakdown so the user can see exactly what's about to
 * happen before clicking. */
function CommitToDb({
  data,
  effectiveRows,
  file,
}: {
  data: TestResponse;
  effectiveRows: TestResultRow[];
  file: File | null;
}) {
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<{
    imported: number;
    skippedDuplicate: number;
    migratedHashes: number;
    backfilledType: number;
    backfilledBalance: number;
    backfilledCategory: number;
    backfilledPostedSeq: number;
    accountsTouched: number;
    aliasesLearned: number;
    importLogIds: string[];
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const confirm = useConfirm();

  // Every resolved row is committable. The endpoint splits them:
  //   - new (no match)                  → insert
  //   - exact (hash matches)            → backfill nulls only
  //   - legacy (old hash matches)       → backfill + migrate hash
  //   - possible (date+amount+payee~)   → backfill + migrate hash
  // Possible matches are now safe because the endpoint's heuristic
  // payee-similarity check (same as the test endpoint) prevents
  // unrelated same-amount rows from false-matching.
  const committableRows = useMemo(
    () => effectiveRows.filter((r) => !!r.resolvedAccountId),
    [effectiveRows],
  );
  const unresolved = useMemo(
    () => effectiveRows.filter((r) => !r.resolvedAccountId).length,
    [effectiveRows],
  );
  // Per-bucket counts so the user knows exactly what the commit will do.
  const newCount = committableRows.filter((r) => !r.matchType).length;
  // Split exact matches: rows the commit will actually backfill vs
  // rows that are field-for-field identical to the DB row (commit
  // writes nothing for them — `continue`s in the loop).
  const exactBackfillCount = committableRows.filter(
    (r) => r.matchType === "exact" && !isExactNoOp(r),
  ).length;
  const exactNoOpCount = committableRows.filter(
    (r) => r.matchType === "exact" && isExactNoOp(r),
  ).length;
  const legacyCount = committableRows.filter((r) => r.matchType === "legacy").length;
  const possibleCount = committableRows.filter((r) => r.matchType === "possible").length;
  /** Rows the commit will materially change. New rows are inserts;
   * legacy/possible always migrate the hash + may backfill; exact rows
   * only count when they have a backfill to do. */
  const willChangeCount =
    newCount + exactBackfillCount + legacyCount + possibleCount;
  const accountBreakdown = useMemo(() => {
    const m = new Map<string, { name: string; count: number }>();
    for (const r of committableRows) {
      if (!r.resolvedAccountId) continue;
      const cur = m.get(r.resolvedAccountId);
      const name = r.resolvedAccountName ?? "(unknown)";
      if (cur) cur.count += 1;
      else m.set(r.resolvedAccountId, { name, count: 1 });
    }
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v }));
  }, [committableRows]);

  async function commit() {
    if (committableRows.length === 0 || !file) return;

    // First-time-format guard. If any of the resolved accounts have
    // never seen this file's format committed before, prompt — the
    // importHash shape differs across formats and a "wrong format"
    // pick would re-insert what looks like duplicates of existing rows.
    const accountIds = Array.from(
      new Set(committableRows.map((r) => r.resolvedAccountId).filter((id): id is string => !!id)),
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
            const prior = a.priorFormats.length > 0
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
          description: r.payee, // tester doesn't track a separate description
          importHash: r.importHash,
          rawId: r.rawId,
          categoryId: r.categoryId ?? null,
          type: r.resolvedType ?? null,
          balance: r.runningBalance ?? null,
          bankAccountId: r.qifAccount?.name ?? null,
        })),
      };
      const res = await fetch("/api/import/commit-batched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Commit failed" }));
        toast.error(error ?? "Commit failed");
        return;
      }
      const result = await res.json();
      setCommitted(result);
      const updatePieces: string[] = [];
      if (result.migratedHashes) updatePieces.push(`${result.migratedHashes} hashes migrated`);
      if (result.backfilledType) updatePieces.push(`${result.backfilledType} types filled`);
      if (result.backfilledBalance) updatePieces.push(`${result.backfilledBalance} balances filled`);
      if (result.backfilledCategory) updatePieces.push(`${result.backfilledCategory} categories filled`);
      if (result.backfilledPostedSeq) updatePieces.push(`${result.backfilledPostedSeq} sequences filled`);
      const updateText = updatePieces.length > 0 ? ` · ${updatePieces.join(" · ")}` : "";
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
    } finally {
      setCommitting(false);
    }
  }

  if (committed) {
    const backfilledBits = [
      committed.migratedHashes > 0 && `${committed.migratedHashes} legacy hashes migrated`,
      committed.backfilledType > 0 && `${committed.backfilledType} type fields filled`,
      committed.backfilledBalance > 0 && `${committed.backfilledBalance} balance fields filled`,
      committed.backfilledCategory > 0 && `${committed.backfilledCategory} category fields filled`,
      committed.backfilledPostedSeq > 0 && `${committed.backfilledPostedSeq} sequence fields filled`,
    ].filter((s): s is string => !!s);

    async function undo() {
      if (!committed) return;
      if (committed.importLogIds.length === 0) {
        toast.info("Nothing to undo — no transactions were inserted.");
        return;
      }
      const ok = await confirm({
        title: "Undo last commit",
        description: `Delete ${committed.imported} just-inserted transaction${committed.imported === 1 ? "" : "s"}? This won't reverse type/balance backfills on existing rows.`,
        confirmLabel: "Undo commit",
      });
      if (!ok) return;
      setUndoing(true);
      try {
        const res = await fetch("/api/import/undo-commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ importLogIds: committed.importLogIds }),
        });
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: "Undo failed" }));
          toast.error(error ?? "Undo failed");
          return;
        }
        const result = await res.json();
        toast.success(
          `Deleted ${result.deletedTransactions} transaction${result.deletedTransactions === 1 ? "" : "s"} and ${result.deletedImportLogs} import log${result.deletedImportLogs === 1 ? "" : "s"}.`,
        );
        setCommitted(null);
      } finally {
        setUndoing(false);
      }
    }

    return (
      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Committed.</p>
              <p className="text-xs text-muted-foreground">
                Imported {committed.imported} transactions across{" "}
                {committed.accountsTouched} account
                {committed.accountsTouched === 1 ? "" : "s"} ·{" "}
                {committed.skippedDuplicate} duplicates skipped ·{" "}
                {committed.aliasesLearned} alias
                {committed.aliasesLearned === 1 ? "" : "es"} learned.
              </p>
              {backfilledBits.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Backfilled on existing rows: {backfilledBits.join(" · ")}.
                </p>
              )}
            </div>
            {committed.imported > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={undo}
                disabled={undoing}
                className="border-red-500/40 text-red-600 hover:bg-red-500/10"
              >
                {undoing
                  ? "Undoing…"
                  : `Undo (delete ${committed.imported} insert${committed.imported === 1 ? "" : "s"})`}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Commit transactions to DB</p>
            <p className="text-xs text-muted-foreground">
              New rows insert. Exact/legacy matches get type/balance/
              category backfilled if those fields are null on the
              existing DB row, and legacy hashes migrate forward.
              Possible matches re-insert (different format/hash from the
              original record).
            </p>
            <ul className="text-xs flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
              {newCount > 0 && (
                <li>
                  <span className="font-medium tabular-nums">{newCount}</span>{" "}
                  <span className="text-muted-foreground">new (insert)</span>
                </li>
              )}
              {exactBackfillCount > 0 && (
                <li className="text-emerald-600">
                  <span className="font-medium tabular-nums">{exactBackfillCount}</span>{" "}
                  exact (backfill missing fields)
                </li>
              )}
              {exactNoOpCount > 0 && (
                <li className="text-muted-foreground">
                  <span className="font-medium tabular-nums">{exactNoOpCount}</span>{" "}
                  identical (no change)
                </li>
              )}
              {legacyCount > 0 && (
                <li className="text-amber-600">
                  <span className="font-medium tabular-nums">{legacyCount}</span>{" "}
                  legacy (migrate hash + backfill)
                </li>
              )}
              {possibleCount > 0 && (
                <li className="text-orange-600">
                  <span className="font-medium tabular-nums">{possibleCount}</span>{" "}
                  possible (migrate hash + backfill, payee verified)
                </li>
              )}
            </ul>
            {accountBreakdown.length > 0 && (
              <ul className="text-xs space-y-0.5 mt-1">
                {accountBreakdown.map((a) => (
                  <li key={a.id} className="flex gap-3">
                    <span className="font-medium">{a.name}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {a.count} row{a.count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
              willChangeCount === 0
            }
            title={
              committableRows.length === 0
                ? "No committable rows"
                : willChangeCount === 0
                  ? "Every row is already in the DB with the same fields — nothing to do."
                  : undefined
            }
          >
            {committing
              ? "Committing…"
              : willChangeCount === 0
                ? "Nothing to commit"
                : newCount > 0
                  ? `Commit ${willChangeCount} row${willChangeCount === 1 ? "" : "s"}`
                  : `Update ${willChangeCount} matched row${willChangeCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function hasAnyOfxMeta(m: OFXMeta): boolean {
  return !!(
    m.institution || m.accountId || m.accountType || m.bankId || m.currency ||
    m.statementStart || m.statementEnd || m.ledgerBalance || m.availableBalance
  );
}

function hasAnyFieldStats(s: TestResponse["fieldStats"]): boolean {
  return s.withBankCategory + s.withCheckNum + s.withCleared + s.withSplits + s.withTrnType + s.withRefNum > 0;
}

function SaveLearnedAliases({ rows }: { rows: TestResultRow[] }) {
  const [saving, setSaving] = useState(false);
  // Group bank-account-id → resolvedAccountId pairs that came from the
  // heuristic-match path AND haven't already been learned via the alias
  // table. Only those are net-new mappings the user might want to persist.
  const candidates = useMemo(() => {
    const byKey = new Map<string, { value: string; accountId: string; accountName: string; rowCount: number }>();
    for (const r of rows) {
      if (r.resolvedAccountVia !== "heuristic-match") continue;
      if (!r.qifAccount?.name || !r.resolvedAccountId || !r.resolvedAccountName) continue;
      const key = r.qifAccount.name;
      const cur = byKey.get(key);
      if (cur) cur.rowCount += 1;
      else byKey.set(key, {
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
          aliases: candidates.map((c) => ({ kind: "bank-account", value: c.value, accountId: c.accountId })),
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Save failed" }));
        toast.error(error ?? "Save failed");
      } else {
        const { saved } = await res.json();
        toast.success(`Saved ${saved} alias${saved === 1 ? "" : "es"}. Re-run the test to see them resolve via "alias".`);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-4 space-y-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Learned account mappings (heuristic)
        </p>
        <p className="text-xs text-muted-foreground">
          The tester resolved these bank IDs via the date+amount heuristic.
          Save them as account_aliases entries so subsequent imports route
          directly without re-checking.
        </p>
        <ul className="text-xs space-y-0.5">
          {candidates.map((c) => (
            <li key={c.value} className="flex gap-3">
              <span className="font-mono">{c.value}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-medium">{c.accountName}</span>
              <span className="text-muted-foreground tabular-nums">{c.rowCount} rows</span>
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

/** Inline category picker rendered on every row's Category cell. When
 * the row already has a (suggested) category, the trigger shows it and
 * picking another value POSTs an override rule. For uncategorised rows
 * the trigger shows the placeholder. Either way the change creates a
 * payee_rule so future imports auto-classify. */
function RuleCreator({
  normalizedPayee,
  currentCategoryId,
  amount,
  categories,
  onCreated,
}: {
  normalizedPayee: string;
  currentCategoryId: string | null;
  /** Row amount as a numeric string. Sent to the rule POST so the
   * server can ask the trigram suggester whether a rule is even
   * needed for this (payee, amount) tuple. */
  amount?: string;
  categories: CategoryOption[];
  onCreated: (cat: CategoryOption) => void;
}) {
  const [saving, setSaving] = useState(false);
  // Walk the full 3-level category tree (parent → child → grandchild),
  // grouped by income vs expense so the dropdown is scannable. Each
  // emitted item carries its depth (for indentation) and full path
  // (for the trigger label lookup of the current value).
  const { incomeItems, expenseItems, byId } = useMemo(() => {
    const childrenOf = new Map<string, CategoryOption[]>();
    for (const c of categories) {
      if (!c.parentId) continue;
      const arr = childrenOf.get(c.parentId) ?? [];
      arr.push(c);
      childrenOf.set(c.parentId, arr);
    }
    for (const arr of childrenOf.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name));
    }
    const parents = categories
      .filter((c) => !c.parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
    type Entry = { cat: CategoryOption; depth: number; path: string };
    const expense: Entry[] = [];
    const income: Entry[] = [];
    function walk(cat: CategoryOption, depth: number, parentPath: string, into: Entry[]) {
      const path = parentPath ? `${parentPath} / ${cat.name}` : cat.name;
      into.push({ cat, depth, path });
      const kids = childrenOf.get(cat.id) ?? [];
      for (const k of kids) walk(k, depth + 1, path, into);
    }
    for (const p of parents) {
      walk(p, 0, "", p.type === "income" ? income : expense);
    }
    const idMap = new Map<string, Entry>();
    for (const e of [...expense, ...income]) idMap.set(e.cat.id, e);
    return { incomeItems: income, expenseItems: expense, byId: idMap };
  }, [categories]);
  // base-ui's <SelectValue> renders the raw value string by default; we
  // pass the full category path as children so the trigger shows
  // "Utilities / Electricity" instead of the UUID.
  const currentLabel = currentCategoryId ? byId.get(currentCategoryId)?.path ?? null : null;

  async function handleChange(catId: string) {
    if (!catId) return;
    if (catId === currentCategoryId) return; // confirm-without-change is a no-op
    const cat = categories.find((c) => c.id === catId);
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
        const { error } = await res.json().catch(() => ({ error: "Save failed" }));
        toast.error(error ?? "Save failed");
        return;
      }
      const json = await res.json();
      // Reflect the pick locally regardless of which branch the server
      // took — the row's category is the source of truth for the
      // current import; the toast describes whether a rule was written.
      onCreated(cat);
      if (json.deleted) {
        toast.success(
          `Rule removed — trigram already picks ${cat.name} for "${normalizedPayee}"`,
        );
      } else if (json.noop) {
        // No write happened; tell the user why so they don't think the
        // pick was lost.
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

  return (
    <Select
      value={currentCategoryId ?? ""}
      onValueChange={(v) => handleChange(v ?? "")}
      disabled={saving || categories.length === 0 || !normalizedPayee}
    >
      <SelectTrigger
        className="h-7 text-xs px-2 py-0 min-w-[160px]"
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue placeholder={saving ? "Saving…" : "Set category…"}>
          {currentLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {expenseItems.length > 0 && (
          <SelectGroup>
            <SelectLabel>Expense</SelectLabel>
            {expenseItems.map(({ cat, depth }) => (
              <SelectItem
                key={cat.id}
                value={cat.id}
                style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
              >
                {cat.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {incomeItems.length > 0 && (
          <SelectGroup>
            <SelectLabel>Income</SelectLabel>
            {incomeItems.map(({ cat, depth }) => (
              <SelectItem
                key={cat.id}
                value={cat.id}
                style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
              >
                {cat.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}

function MetaField({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums break-words">{value}</dd>
    </div>
  );
}

function FieldStat({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <li className={cn("flex justify-between gap-3", count === 0 && "text-muted-foreground/60")}>
      <span>{label}</span>
      <span className="tabular-nums">
        {count} / {total} <span className="text-muted-foreground">({pct}%)</span>
      </span>
    </li>
  );
}

const MATCH_BORDER_TONE: Record<NonNullable<TestResultRow["matchType"]>, string> = {
  exact: "border-l-2 border-emerald-500",
  legacy: "border-l-2 border-amber-500",
  possible: "border-l-2 border-orange-500",
};

const MATCH_LABEL_TONE: Record<NonNullable<TestResultRow["matchType"]>, string> = {
  exact: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  legacy: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  possible: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
};

/** Side-by-side comparison row. Replaces the standard table row for any
 * row with a matchType so the user can compare imported vs DB at a
 * glance. Differences amber-tinted on the right (DB) side. */
function ComparisonRow({
  row,
  showAccountColumn,
  totalCols,
  canExpand,
  isOpen,
  onToggle,
  categories,
  onRuleCreated,
}: {
  row: TestResultRow;
  showAccountColumn: boolean;
  totalCols: number;
  canExpand: boolean;
  isOpen: boolean;
  onToggle: () => void;
  categories: CategoryOption[];
  onRuleCreated: (cat: CategoryOption) => void;
}) {
  const Chev = isOpen ? ChevronDown : ChevronRight;
  const newAmt = parseFloat(row.amount);
  const existingAmtNum =
    row.existingAmount != null ? parseFloat(row.existingAmount) : NaN;
  const matchType = row.matchType!;
  const badge = METHOD_BADGE[row.method];

  // Diff predicates — case-insensitive trim on payee so trivial whitespace
  // doesn't trigger a highlight.
  const dateDiff = (row.existingDate ?? "") !== row.date;
  const amountDiff = (row.existingAmount ?? "") !== row.amount;
  const payeeDiff =
    (row.existingPayee ?? "").trim().toUpperCase() !==
    row.payee.trim().toUpperCase();
  const categoryDiff =
    (row.existingCategoryName ?? "") !== (row.categoryName ?? "");
  // Compare the *resolved* account (what the importer would route this row
  // to) against the existing-record's account, since that's the
  // meaningful comparison — the raw bank-account-id on the file is
  // diagnostic, not a routing target.
  const accountDiff =
    !!row.resolvedAccountName &&
    !!row.existingAccountName &&
    row.resolvedAccountName !== row.existingAccountName;
  const typeDiff =
    (row.resolvedType ?? "") !== (row.existingType ?? "") &&
    !!(row.resolvedType || row.existingType);
  // Balance comparison — both stored as numeric strings; canonicalize to
  // toFixed(2) before comparing so trivial precision artefacts don't read
  // as a diff.
  const newBalanceNum = row.runningBalance ? parseFloat(row.runningBalance) : NaN;
  const existingBalanceNum = row.existingBalance ? parseFloat(row.existingBalance) : NaN;
  const balanceDiff =
    Number.isFinite(newBalanceNum) &&
    Number.isFinite(existingBalanceNum) &&
    newBalanceNum.toFixed(2) !== existingBalanceNum.toFixed(2);

  const diffTone = "text-amber-700 dark:text-amber-300";

  // Compact format-extras list for the imported side.
  const extras: string[] = [];
  if (row.refNum) extras.push(`ref: ${row.refNum}`);
  if (row.runningBalance) extras.push(`bal: ${row.runningBalance}`);

  return (
    <tr
      className={cn(
        MATCH_BORDER_TONE[matchType],
        canExpand && "cursor-pointer hover:bg-muted/40",
      )}
      onClick={canExpand ? onToggle : undefined}
    >
      <td className="px-2 py-2 align-top">
        {canExpand ? <Chev className="h-3.5 w-3.5 text-muted-foreground" /> : null}
      </td>
      <td colSpan={totalCols - 1} className="p-0 align-top">
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Left: new (this import) */}
          <div className="px-3 py-2 space-y-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Importing</span>
              <Badge className={cn("font-normal text-[10px]", MATCH_LABEL_TONE[matchType])}>
                {matchType}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="tabular-nums text-muted-foreground">{row.date}</span>
              <span className={cn("tabular-nums font-medium", amountClass(newAmt))}>
                {formatAUD(newAmt)}
              </span>
              <span className="text-muted-foreground">
                acct:{" "}
                <span className={cn(row.resolvedAccountName ? "text-foreground" : "text-muted-foreground/60 italic")}>
                  {row.resolvedAccountName ?? "unresolved"}
                </span>
                {row.resolvedAccountVia && (
                  <span className="ml-1 text-[10px] text-muted-foreground/60">
                    via {row.resolvedAccountVia}
                  </span>
                )}
                {row.qifAccount?.name && (
                  <span className="ml-1 text-[10px] text-muted-foreground/60 font-mono">
                    [{row.qifAccount.name}]
                  </span>
                )}
              </span>
            </div>
            <div className="text-sm font-medium break-words">{row.payee || "—"}</div>
            {row.normalizedPayee && row.normalizedPayee !== row.payee && (
              <div className="text-[10px] text-muted-foreground">
                normalised: {row.normalizedPayee}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground inline-flex items-center gap-1.5">
                category:
                <RuleCreator
                  normalizedPayee={row.normalizedPayee}
                  currentCategoryId={row.categoryId}
                  amount={row.amount}
                  categories={categories}
                  onCreated={onRuleCreated}
                />
              </span>
              <Badge className={cn("font-normal text-[10px]", badge.className)}>
                {badge.label}
                {row.method === "trigram" && row.score != null && (
                  <span className="ml-1 opacity-70">
                    {(row.score * 100).toFixed(0)}% · {row.support}n
                  </span>
                )}
              </Badge>
              {row.resolvedType && (
                <span className="text-muted-foreground">
                  type: <span className="text-foreground">{row.resolvedType}</span>
                </span>
              )}
              {row.runningBalance && (
                <span className="text-muted-foreground">
                  bal:{" "}
                  <span className="text-foreground tabular-nums">
                    {formatAUD(parseFloat(row.runningBalance))}
                  </span>
                  {row.balanceCheck && (
                    <span
                      className={cn(
                        "ml-1 font-medium",
                        row.balanceCheck.match ? "text-emerald-600" : "text-red-600",
                      )}
                      title={
                        (row.balanceCheck.mode === "chain"
                          ? "Chain check (vs previous row in this account)"
                          : "Anchor check (vs DB starting balance + prior dates)") +
                        " — " +
                        (row.balanceCheck.match
                          ? `predicted ${formatAUD(row.balanceCheck.predicted)} ✓`
                          : `predicted ${formatAUD(row.balanceCheck.predicted)}, file says ${formatAUD(row.balanceCheck.claimed)} (Δ ${formatAUD(row.balanceCheck.delta)})`)
                      }
                    >
                      {row.balanceCheck.match ? "✓" : "✗"}
                    </span>
                  )}
                </span>
              )}
            </div>
            {extras.length > 0 && (
              <div className="text-[10px] text-muted-foreground/80 font-mono">
                {extras.join(" · ")}
              </div>
            )}
          </div>

          {/* Right: existing (in DB) */}
          <div className="px-3 py-2 space-y-1 border-t md:border-t-0 md:border-l bg-muted/30">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              In DB
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className={cn("tabular-nums", dateDiff ? diffTone : "text-muted-foreground")}>
                {row.existingDate ?? "—"}
              </span>
              <span
                className={cn(
                  "tabular-nums font-medium",
                  amountDiff
                    ? diffTone
                    : Number.isFinite(existingAmtNum)
                      ? amountClass(existingAmtNum)
                      : "text-muted-foreground",
                )}
              >
                {Number.isFinite(existingAmtNum) ? formatAUD(existingAmtNum) : "—"}
              </span>
              <span className={cn(accountDiff ? diffTone : "text-muted-foreground")}>
                acct: {row.existingAccountName ?? "—"}
              </span>
            </div>
            <div
              className={cn(
                "text-sm font-medium break-words",
                payeeDiff && diffTone,
              )}
            >
              {row.existingPayee || "—"}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">
                category:{" "}
                <span className={cn(categoryDiff ? diffTone : "text-foreground")}>
                  {row.existingCategoryName ?? "—"}
                </span>
              </span>
              {(row.existingType || row.resolvedType) && (
                <span className="text-muted-foreground">
                  type:{" "}
                  <span className={cn(typeDiff ? diffTone : "text-foreground")}>
                    {row.existingType ?? "—"}
                  </span>
                </span>
              )}
              {(row.existingBalance || row.runningBalance) && (
                <span className="text-muted-foreground">
                  bal:{" "}
                  <span
                    className={cn(
                      "tabular-nums",
                      balanceDiff ? diffTone : "text-foreground",
                    )}
                  >
                    {Number.isFinite(existingBalanceNum)
                      ? formatAUD(existingBalanceNum)
                      : "—"}
                  </span>
                </span>
              )}
              {row.balanceCheck && (
                <span className="text-muted-foreground">
                  computed:{" "}
                  <span
                    className={cn(
                      "tabular-nums",
                      row.balanceCheck.match
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                    title={
                      (row.balanceCheck.mode === "chain"
                        ? "Chain check: previous row's balance + this row's amount"
                        : "Anchor check: starting balance + DB transactions strictly before this date") +
                      (row.balanceCheck.match
                        ? ""
                        : ` — file says ${formatAUD(row.balanceCheck.claimed)} (Δ ${formatAUD(row.balanceCheck.delta)})`)
                    }
                  >
                    {formatAUD(row.balanceCheck.predicted)}
                  </span>
                  <span className="ml-1 text-[10px] text-muted-foreground/60">
                    ({row.balanceCheck.mode})
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function RowGroup({
  row,
  isOpen,
  canExpand,
  showAccountColumn,
  onToggle,
  categories,
  onRuleCreated,
}: {
  row: TestResultRow;
  isOpen: boolean;
  canExpand: boolean;
  showAccountColumn: boolean;
  onToggle: () => void;
  categories: CategoryOption[];
  onRuleCreated: (cat: CategoryOption) => void;
}) {
  const Chev = isOpen ? ChevronDown : ChevronRight;
  const amt = parseFloat(row.amount);
  const badge = METHOD_BADGE[row.method];

  // Inline chips — short single-value extras that don't need expansion.
  const chips: { label: string; value: string; tone?: string }[] = [];
  // Matched rows render via ComparisonRow (side-by-side panel) so no
  // dupe chip needed here.
  // Skip the inline acct chip when there's a dedicated Account column —
  // would just be redundant.
  if (row.qifAccount?.name && !showAccountColumn) {
    chips.push({ label: "acct", value: row.qifAccount.name, tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" });
  }
  if (row.trnType) chips.push({ label: "type", value: row.trnType, tone: "bg-purple-500/15 text-purple-700 dark:text-purple-300" });
  if (row.bankCategory) chips.push({ label: "bank cat", value: row.bankCategory, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" });
  if (row.checkNum) chips.push({ label: "chk", value: row.checkNum });
  if (row.refNum) chips.push({ label: "ref", value: row.refNum });
  if (row.cleared) chips.push({ label: "cleared", value: row.cleared });
  if (row.runningBalance) chips.push({ label: "bal", value: row.runningBalance });

  return (
    <>
      <tr className={cn(canExpand && "cursor-pointer hover:bg-muted/40")} onClick={canExpand ? onToggle : undefined}>
        <td className="px-2 py-2">
          {canExpand ? <Chev className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums whitespace-nowrap">
          {row.date}
        </td>
        <td className={cn("px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium", amountClass(amt))}>
          {formatAUD(amt)}
        </td>
        {showAccountColumn && (
          <td className="px-3 py-2 whitespace-nowrap">
            {row.qifAccount?.name || row.resolvedAccountName ? (
              <span className="text-xs flex flex-col">
                {/* Resolved DB account name on top so it reads at a
                    glance which app-account this row would land in. */}
                <span className={cn(
                  "font-medium",
                  row.resolvedAccountName ? "" : "text-muted-foreground/60 italic",
                )}>
                  {row.resolvedAccountName ?? "unresolved"}
                </span>
                {/* Bank ID + resolution path underneath for traceability. */}
                {row.qifAccount?.name && (
                  <span className="text-muted-foreground/70 text-[10px] font-mono">
                    {row.qifAccount.name}
                    {row.resolvedAccountVia && row.resolvedAccountName && (
                      <span className="ml-1 not-italic">via {row.resolvedAccountVia}</span>
                    )}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground italic text-xs">—</span>
            )}
          </td>
        )}
        <td className="px-3 py-2 min-w-0">
          <div className="font-medium truncate max-w-[420px]">{row.payee || "—"}</div>
          {row.normalizedPayee && row.normalizedPayee !== row.payee && (
            <div className="text-[10px] text-muted-foreground truncate max-w-[420px]">
              normalised: {row.normalizedPayee}
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-mono whitespace-nowrap",
                    c.tone ?? "bg-muted text-muted-foreground",
                  )}
                  title={c.label}
                >
                  <span className="opacity-60 mr-1">{c.label}:</span>
                  {c.value}
                </span>
              ))}
            </div>
          )}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <RuleCreator
            normalizedPayee={row.normalizedPayee}
            currentCategoryId={row.categoryId}
            amount={row.amount}
            categories={categories}
            onCreated={onRuleCreated}
          />
        </td>
        <td className="px-3 py-2 whitespace-nowrap">
          <Badge className={cn("font-normal text-[10px]", badge.className)}>
            {badge.label}
            {row.method === "trigram" && row.score != null && (
              <span className="ml-1 opacity-70">
                {(row.score * 100).toFixed(0)}% · {row.support}n
              </span>
            )}
          </Badge>
        </td>
      </tr>
      {canExpand && isOpen && (
        <tr className="bg-muted/20">
          <td />
          <td colSpan={showAccountColumn ? 6 : 5} className="px-3 py-3 space-y-3">
            {row.splits && row.splits.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  Splits (S/E/$ from QIF):
                </p>
                <ul className="text-xs space-y-0.5">
                  {row.splits.map((s, j) => (
                    <li key={j} className="flex gap-3">
                      <span className="w-48 truncate">{s.category ?? "—"}</span>
                      <span className="text-muted-foreground truncate flex-1">{s.memo ?? ""}</span>
                      {s.amount && (
                        <span className="tabular-nums">{formatAUD(parseFloat(s.amount))}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {row.address && row.address.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">Address (A from QIF):</p>
                <ul className="text-xs">
                  {row.address.map((a, j) => (
                    <li key={j}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {row.categoryRanges && row.categoryRanges.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  Categories in the matched neighbourhood (amount range across
                  similar historical txns):
                </p>
                <ul className="text-xs space-y-0.5">
                  {row.categoryRanges.map((cr, j) => {
                    const inRange =
                      Math.abs(amt) >= cr.minAmount && Math.abs(amt) <= cr.maxAmount;
                    return (
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
                        <span className="w-64 truncate" title={cr.categoryName ?? undefined}>
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
                        {!inRange && (
                          <span
                            className="text-[10px] text-amber-600"
                            title="Incoming amount falls outside this category's typical range"
                          >
                            (incoming {formatAUD(Math.abs(amt))} outside range)
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {row.neighbours && row.neighbours.length > 0 && (
              <div>
                <p className="text-[11px] text-muted-foreground mb-1.5">
                  Top {row.neighbours.length} nearest neighbours:
                </p>
                <ul className="text-xs space-y-0.5">
                  {row.neighbours.map((n, j) => (
                    <li key={j} className="flex gap-3">
                      <span className="tabular-nums text-muted-foreground w-12">
                        {(n.similarity * 100).toFixed(0)}%
                      </span>
                      <span className="font-mono text-[11px] truncate max-w-[300px]" title={n.normalizedPayee}>
                        {n.normalizedPayee}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {formatAUD(n.amount)}
                      </span>
                      <span className="text-muted-foreground">·</span>
                      <span>{n.categoryName ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
