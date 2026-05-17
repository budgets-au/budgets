"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, Check, X } from "lucide-react";
import { toast } from "sonner";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import { InvestmentHistoryChart } from "./investment-history-chart";
import { AnnouncementsPanel } from "./announcements-panel";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface DetailRow {
  id: string;
  kind: string;
  symbol: string;
  exchange: string;
  name: string | null;
  currency: string;
  quantity: string;
  purchaseDate: string;
  purchasePrice: string | null;
  strikePrice: string | null;
  expiryDate: string | null;
  notes: string | null;
  vests: VestRow[];
}

interface VestRow {
  id: string;
  vestDate: string;
  quantity: string;
  performanceNote: string | null;
  isSatisfied: boolean;
}

interface HistoryResponse {
  series: { date: string; close: number; value: number }[];
  dividends: { date: string; perShare: number; totalAmount: number }[];
  dividendsTotal: number;
}

type Range = "1m" | "3m" | "1y" | "5y" | "all";
const RANGES: Range[] = ["1m", "3m", "1y", "5y", "all"];
type ChartMode = "value" | "price";

export function InvestmentDetailPanel({ id }: { id: string }) {
  const [range, setRange] = useState<Range>("1y");
  const [mode, setMode] = useState<ChartMode>("value");
  const { data: detail } = useSWR<DetailRow>(`/api/investments/${id}`, fetcher);
  const historyUrl =
    range === "all"
      ? `/api/investments/${id}/history`
      : `/api/investments/${id}/history?range=${range}`;
  const { data: history } = useSWR<HistoryResponse>(historyUrl, fetcher);

  if (!detail) {
    return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  }

  // Yahoo can return an error body (e.g. 502 on flaky upstream); SWR resolves
  // it to `history` without surfacing the failure, so guard every access.
  const historyOK =
    history && Array.isArray(history.series) && Array.isArray(history.dividends);
  const series = historyOK ? history.series : [];
  const dividends = historyOK ? history.dividends : [];
  const dividendsTotal = historyOK ? history.dividendsTotal : 0;
  // The chart paints every dividend in the window (with pre-/post-purchase
  // colouring); the list panel below shows only the ones the user actually
  // received — i.e. on or after the trade date.
  const receivedDividends = dividends.filter(
    (d) => d.date >= detail.purchaseDate,
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-semibold">
          {detail.symbol} <span className="text-muted-foreground font-normal text-sm">· {detail.name}</span>
        </p>
        <p className="text-xs text-muted-foreground capitalize">
          {detail.kind} · {detail.exchange} · {detail.currency}
          {detail.expiryDate ? ` · expires ${formatDate(detail.expiryDate)}` : ""}
        </p>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {mode === "value" ? "Value over time" : "Price over time"}
            </p>
            <div className="flex items-center gap-1.5">
              <ModePicker mode={mode} onMode={setMode} />
              <RangePicker range={range} onRange={setRange} />
            </div>
          </div>
          <InvestmentHistoryChart
            series={series}
            dividends={dividends}
            vests={detail.vests
              .filter((v) => v.isSatisfied)
              .map((v) => ({
                date: v.vestDate,
                label: `+${parseFloat(v.quantity)}`,
              }))}
            currency={detail.currency}
            purchaseDate={detail.purchaseDate}
            mode={mode}
          />
          {dividendsTotal > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Dividends received:{" "}
              <span className={`font-medium ${amountClass(dividendsTotal)}`}>
                {formatAUD(dividendsTotal)}
              </span>{" "}
              · {receivedDividends.length} payment
              {receivedDividends.length === 1 ? "" : "s"}
            </p>
          )}
        </CardContent>
      </Card>

      {(detail.kind === "rsu" || detail.kind === "option") && (
        <VestsPanel
          investmentId={id}
          vests={detail.vests}
          isOption={detail.kind === "option"}
        />
      )}

      {receivedDividends.length > 0 && (
        <DividendsList dividends={receivedDividends} currency={detail.currency} />
      )}

      <AnnouncementsPanel investmentId={id} />
    </div>
  );
}

function ModePicker({
  mode,
  onMode,
}: {
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
}) {
  const options: { v: ChartMode; label: string }[] = [
    { v: "value", label: "Value" },
    { v: "price", label: "Price" },
  ];
  return (
    <div
      role="tablist"
      aria-label="Chart mode"
      className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
    >
      {options.map(({ v, label }) => (
        <button
          key={v}
          role="tab"
          aria-selected={mode === v}
          onClick={() => onMode(v)}
          className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
            mode === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function RangePicker({
  range,
  onRange,
}: {
  range: Range;
  onRange: (r: Range) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Chart range"
      className="inline-flex items-center gap-0.5 rounded-md border bg-muted/30 p-0.5"
    >
      {RANGES.map((r) => (
        <button
          key={r}
          role="tab"
          aria-selected={range === r}
          onClick={() => onRange(r)}
          className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded transition-colors ${
            range === r
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}

function VestsPanel({
  investmentId,
  vests,
  isOption,
}: {
  investmentId: string;
  vests: VestRow[];
  isOption: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [vestDate, setVestDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [performanceNote, setPerformanceNote] = useState("");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!vestDate || !quantity) return;
    const res = await fetch(`/api/investments/${investmentId}/vests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vestDate,
        quantity,
        performanceNote: performanceNote || null,
        isSatisfied: true,
      }),
    });
    if (res.ok) {
      toast.success("Vest added");
      setVestDate("");
      setQuantity("");
      setPerformanceNote("");
      setAdding(false);
      mutate(`/api/investments/${investmentId}`);
      mutate(`/api/investments/${investmentId}/history`);
    } else {
      toast.error("Failed to add vest");
    }
  }

  async function handleToggle(vestId: string, next: boolean) {
    const res = await fetch(`/api/investments/vests/${vestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSatisfied: next }),
    });
    if (res.ok) {
      mutate(`/api/investments/${investmentId}`);
      mutate(`/api/investments/${investmentId}/history`);
    }
  }

  async function handleDelete(vestId: string) {
    const res = await fetch(`/api/investments/vests/${vestId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast.success("Vest removed");
      mutate(`/api/investments/${investmentId}`);
      mutate(`/api/investments/${investmentId}/history`);
    }
  }

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Vesting schedule
          </p>
          {!adding && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAdding(true)}
            >
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          )}
        </div>

        {vests.length === 0 && !adding ? (
          <p className="text-xs text-muted-foreground">No vests scheduled yet.</p>
        ) : (
          <ul className="divide-y text-sm">
            {vests.map((v) => (
              <li
                key={v.id}
                className={`flex items-center justify-between gap-2 py-2 ${
                  v.isSatisfied ? "" : "opacity-50"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="tabular-nums">{formatDate(v.vestDate)}</span>
                    <span className="ml-2 font-medium">{parseFloat(v.quantity)} units</span>
                  </p>
                  {v.performanceNote && (
                    <p className="text-[11px] text-muted-foreground italic">
                      {v.performanceNote}
                    </p>
                  )}
                </div>
                {(isOption || v.performanceNote) && (
                  <button
                    type="button"
                    onClick={() => handleToggle(v.id, !v.isSatisfied)}
                    className={`p-1 rounded transition-colors ${
                      v.isSatisfied
                        ? "text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    title={v.isSatisfied ? "Mark not satisfied" : "Mark satisfied"}
                    aria-label={v.isSatisfied ? "Mark not satisfied" : "Mark satisfied"}
                  >
                    {v.isSatisfied ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(v.id)}
                  className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-muted"
                  aria-label="Delete vest"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {adding && (
          <form onSubmit={handleAdd} className="mt-3 space-y-2 border-t pt-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Vest date</Label>
                <Input
                  type="date" min="1900-01-01" max="2099-12-31"
                  value={vestDate}
                  onChange={(e) => setVestDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label className="text-xs">Quantity</Label>
                <Input
                  type="number"
                  step="0.000001"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <Label className="text-xs">Performance condition (optional)</Label>
              <Input
                value={performanceNote}
                onChange={(e) => setPerformanceNote(e.target.value)}
                placeholder="e.g. TSR > peer median over 3y"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Add vest
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function DividendsList({
  dividends,
  currency,
}: {
  dividends: { date: string; perShare: number; totalAmount: number }[];
  currency: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Dividend payments
        </p>
        <ul className="divide-y text-sm">
          {dividends
            .slice()
            .reverse()
            .map((d) => (
              <li key={d.date} className="flex justify-between items-center py-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDate(d.date)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {currency} {d.perShare.toFixed(4)}/share
                </span>
                <span className={`font-medium tabular-nums ${amountClass(d.totalAmount)}`}>
                  {formatAUD(d.totalAmount)}
                </span>
              </li>
            ))}
        </ul>
      </CardContent>
    </Card>
  );
}
