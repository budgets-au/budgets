"use client";

import { useMemo, useState } from "react";
import { mutate } from "swr";
import { useSwrJson } from "@/hooks/use-swr-json";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAUD } from "@/lib/utils";
import { currentFyEndYear, fyDateRange, formatFy } from "@/lib/tax/fy";
import type { TaxReport } from "@/app/api/reports/tax/route";


export function TaxDeductionsReport({ accountIds }: { accountIds: string[] }) {
  const [fyEndYear, setFyEndYear] = useState(() => currentFyEndYear());

  const accountIdsParam = accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const swrKey = `/api/reports/tax?fyEndYear=${fyEndYear}${accountIdsParam}`;
  const { data, isLoading } = useSwrJson<TaxReport>(swrKey);

  const settingsKey = "/api/settings";
  const { data: settings } = useSwrJson<{
    taxConfig: { wfhHoursByFy: Record<string, number>; categoryRules: Record<string, { workUsePct: number; bundledInWfh: boolean; note?: string }> };
  }>(settingsKey);

  const fyOptions = useMemo(() => {
    const cur = currentFyEndYear();
    const out: number[] = [];
    for (let y = cur + 1; y >= cur - 4; y--) out.push(y);
    return out;
  }, []);

  const hours = settings?.taxConfig?.wfhHoursByFy?.[String(fyEndYear)] ?? 0;
  const fyRange = fyDateRange(fyEndYear);

  async function saveHours(next: number) {
    await fetch(settingsKey, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taxConfig: { wfhHoursByFy: { [String(fyEndYear)]: next } },
      }),
    });
    mutate(settingsKey);
    mutate(swrKey);
  }

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading tax report…</p>;
  }

  return (
    <div className="space-y-4 print-landscape">
      {/* Header row — input controls only useful on-screen. The
          per-FY summary card below carries the rendered FY label so
          the print stays self-describing. */}
      <div className="flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Financial year</label>
          <select
            value={fyEndYear}
            onChange={(e) => setFyEndYear(parseInt(e.target.value, 10))}
            className="text-sm border rounded-md px-3 py-2 bg-background min-w-[120px]"
          >
            {fyOptions.map((y) => (
              <option key={y} value={y}>{formatFy(y)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">WFH hours ({formatFy(fyEndYear)})</label>
          <input
            type="number"
            min={0}
            step={1}
            defaultValue={hours}
            key={`hours-${fyEndYear}-${hours}`}
            onBlur={(e) => {
              const n = parseFloat(e.target.value);
              if (!Number.isNaN(n) && n !== hours) saveHours(n);
            }}
            className="text-sm border rounded-md px-3 py-2 bg-background w-32 tabular-nums"
          />
        </div>
        <div className="text-xs text-muted-foreground self-center">
          @ ${data.ratePerHour.toFixed(2)}/hr · {fyRange.from} → {fyRange.to}
        </div>
        {accountIds.length > 0 && (
          <div className="ml-auto text-xs text-muted-foreground self-center">
            Filtered to {accountIds.length} account{accountIds.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400 space-y-1">
          {data.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {/* Summary card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Estimated total claim — {formatFy(fyEndYear)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">{formatAUD(data.summary.total)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            WFH {formatAUD(data.summary.wfhClaim)} · Other {formatAUD(data.summary.otherClaim)}
            {data.wfh.recommended === "actual"
              ? " · Actual-cost method gives the higher claim this FY"
              : data.wfh.actual.claim > 0
                ? " · Fixed-rate method gives the higher claim this FY"
                : ""}
          </p>
        </CardContent>
      </Card>

      {/* WFH section */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className={data.wfh.recommended === "fixed" ? "ring-2 ring-indigo-500/40" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>Fixed-rate method</span>
              {data.wfh.recommended === "fixed" && (
                <span className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Recommended</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatAUD(data.wfh.fixed.claim)}</p>
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
              {data.wfh.fixed.hours} hrs × ${data.wfh.fixed.rate.toFixed(2)}/hr
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-2 leading-relaxed">
              Covers electricity, gas, internet, mobile/home phone, stationery and computer
              consumables. These categories cannot be claimed separately under this method.
            </p>
          </CardContent>
        </Card>

        <Card className={data.wfh.recommended === "actual" ? "ring-2 ring-indigo-500/40" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center justify-between">
              <span>Actual-cost method</span>
              {data.wfh.recommended === "actual" && (
                <span className="text-[10px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Recommended</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatAUD(data.wfh.actual.claim)}</p>
            {data.wfh.actual.categories.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">
                No bundled categories have a work-use % set. Open Settings below to configure.
              </p>
            ) : (
              <table className="w-full text-xs mt-3">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-left font-medium py-1">Category</th>
                    <th className="text-right font-medium py-1">Spent</th>
                    <th className="text-right font-medium py-1">%</th>
                    <th className="text-right font-medium py-1">Claim</th>
                  </tr>
                </thead>
                <tbody>
                  {data.wfh.actual.categories.map((c) => (
                    <tr key={c.categoryId} className="border-b border-border/40">
                      <td className="py-1 truncate">
                        <Link
                          href={`/transactions?categoryId=${c.categoryId}&from=${data.fyRange.from}&to=${data.fyRange.to}`}
                          className="hover:underline hover:text-indigo-600"
                        >
                          {c.path.join(" / ")}
                        </Link>
                      </td>
                      <td className="text-right tabular-nums py-1">{formatAUD(c.total)}</td>
                      <td className="text-right tabular-nums py-1 text-muted-foreground">{c.workUsePct}%</td>
                      <td className="text-right tabular-nums py-1 font-medium">{formatAUD(c.claimable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Other deductions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Other deductions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.otherDeductions.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No other categories have a work-use % set. Tag categories like Donations or
              Tax-agent fees in the Settings panel below to surface them here.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left font-medium py-1.5">Category</th>
                  <th className="text-left font-medium py-1.5">Section</th>
                  <th className="text-right font-medium py-1.5">Spent</th>
                  <th className="text-right font-medium py-1.5">%</th>
                  <th className="text-right font-medium py-1.5">Claim</th>
                </tr>
              </thead>
              <tbody>
                {data.otherDeductions.map((row) => (
                  <tr key={row.categoryId} className="border-b border-border/40">
                    <td className="py-1.5">
                      <Link
                        href={`/transactions?categoryId=${row.categoryId}&from=${data.fyRange.from}&to=${data.fyRange.to}`}
                        className="hover:underline hover:text-indigo-600"
                      >
                        {row.path.join(" / ")}
                      </Link>
                    </td>
                    <td className="py-1.5 text-muted-foreground capitalize">
                      {row.section.replace("-", " ")}
                    </td>
                    <td className="text-right tabular-nums py-1.5">{formatAUD(row.total)}</td>
                    <td className="text-right tabular-nums py-1.5 text-muted-foreground">{row.workUsePct}%</td>
                    <td className="text-right tabular-nums py-1.5 font-medium">{formatAUD(row.claimable)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={4} className="text-right py-1.5">Total other</td>
                  <td className="text-right tabular-nums py-1.5">
                    {formatAUD(data.summary.otherClaim)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Configure per-category work-use % and WFH bundle membership in{" "}
        <Link href="/categories" className="underline hover:text-foreground">
          Categories
        </Link>
        . Changes take effect on next report load.
      </p>

      <p className="text-[11px] text-muted-foreground italic">
        Estimate only. Not tax advice. Confirm with a registered tax agent.
      </p>
    </div>
  );
}
