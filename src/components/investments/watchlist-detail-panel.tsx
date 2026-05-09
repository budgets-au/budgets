"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { useDarkMode } from "@/hooks/use-dark-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WatchRow {
  id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  currency: string;
  notes: string | null;
  currentPrice: number | null;
}

interface HistoryResponse {
  series: { date: string; close: number }[];
  dividends: { date: string; perShare: number }[];
}

type Range = "1m" | "3m" | "1y" | "5y" | "all";
const RANGES: Range[] = ["1m", "3m", "1y", "5y", "all"];

export function WatchlistDetailPanel({
  row,
  onClose,
}: {
  row: WatchRow;
  onClose: () => void;
}) {
  const [range, setRange] = useState<Range>("1y");
  const historyUrl =
    range === "all"
      ? `/api/watchlist/${row.id}/history`
      : `/api/watchlist/${row.id}/history?range=${range}`;
  const { data: history } = useSWR<HistoryResponse>(historyUrl, fetcher);
  const [buying, setBuying] = useState(false);

  // Yahoo can return an error body (e.g. 502 on flaky upstream); SWR resolves
  // it to `history` without surfacing the failure. Guard every access.
  const historyOK =
    history && Array.isArray(history.series) && Array.isArray(history.dividends);
  const series = historyOK ? history.series : [];
  const dividends = historyOK ? history.dividends : [];

  const confirm = useConfirm();
  async function handleRemove() {
    const ok = await confirm({
      title: "Remove from watchlist",
      description: `Remove ${row.symbol} from the watchlist?`,
      confirmLabel: "Remove",
    });
    if (!ok) return;
    const res = await fetch(`/api/watchlist/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed");
      mutate("/api/watchlist");
      onClose();
    } else {
      toast.error("Remove failed");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold">
            {row.symbol}{" "}
            <span className="text-muted-foreground font-normal text-sm">
              · {row.name ?? "—"}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Watching · {row.exchange} · {row.currency}
            {row.currentPrice != null && (
              <span className="ml-2 font-medium text-foreground">
                {row.currency} {row.currentPrice.toFixed(2)}
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="outline" onClick={() => setBuying(true)}>
            <ShoppingCart className="h-3.5 w-3.5 mr-1" /> What-if buy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRemove}
            className="text-muted-foreground hover:text-red-500"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Price
            </p>
            <RangePicker range={range} onRange={setRange} />
          </div>
          <PriceChart
            series={series}
            dividends={dividends}
            currency={row.currency}
          />
          {dividends.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {dividends.length} dividend payment
              {dividends.length === 1 ? "" : "s"} in window · last:{" "}
              {row.currency} {dividends.at(-1)!.perShare.toFixed(4)}/share
              on {formatDate(dividends.at(-1)!.date)}
            </p>
          )}
        </CardContent>
      </Card>

      {dividends.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Dividends
            </p>
            <ul className="divide-y text-sm">
              {dividends
                .slice()
                .reverse()
                .map((d) => (
                  <li
                    key={d.date}
                    className="flex justify-between items-center py-2"
                  >
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(d.date)}
                    </span>
                    <span className="font-medium tabular-nums">
                      {row.currency} {d.perShare.toFixed(4)}/share
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {buying && (
        <BuyFromWatchlistDialog
          row={row}
          open={buying}
          onOpenChange={(next) => {
            setBuying(next);
            if (!next) {
              // Refresh in case the watch row was removed during buy.
              mutate("/api/watchlist");
            }
          }}
        />
      )}
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

function PriceChart({
  series,
  dividends,
  currency,
}: {
  series: { date: string; close: number }[];
  dividends: { date: string; perShare: number }[];
  currency: string;
}) {
  const isDark = useDarkMode();

  if (series.length === 0) {
    return <p className="text-xs text-muted-foreground py-3">Loading price history…</p>;
  }

  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e2e8f0"} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(d) => format(parseISO(d), "d MMM")}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={[(min: number) => Math.floor(min * 0.95), (max: number) => Math.ceil(max * 1.05)]}
            tickFormatter={(v: number) =>
              v >= 1000 ? `${currency} ${(v / 1000).toFixed(1)}k` : `${currency} ${Math.round(v)}`
            }
            width={64}
          />
          <Tooltip
            cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
            labelFormatter={(d) => format(parseISO(String(d)), "d MMM yyyy")}
            formatter={(_value, _name, item) => {
              const p = item?.payload as { close: number } | undefined;
              if (!p) return ["—", "Price"];
              return [`${currency} ${p.close.toFixed(2)}`, "Price"];
            }}
            labelStyle={{ fontSize: 11 }}
            contentStyle={{ fontSize: 12, padding: "4px 8px" }}
          />
          <Line
            type="monotone"
            dataKey="close"
            stroke="#6366f1"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          {dividends.map((d) => {
            const point = series.find((p) => p.date === d.date) ?? series[series.length - 1];
            return (
              <ReferenceDot
                key={`div-${d.date}`}
                x={d.date}
                y={point.close}
                r={4}
                fill="#f59e0b"
                stroke="#fff"
                strokeWidth={1}
                label={{
                  value: `${currency} ${d.perShare.toFixed(2)}`,
                  position: "top",
                  fill: "#f59e0b",
                  fontSize: 9,
                  offset: 8,
                }}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BuyFromWatchlistDialog({
  row,
  open,
  onOpenChange,
}: {
  row: WatchRow;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [purchasePrice, setPurchasePrice] = useState("");
  const [notes, setNotes] = useState("");
  const [removeAfter, setRemoveAfter] = useState(true);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!quantity || parseFloat(quantity) <= 0) {
      toast.error("Enter a positive quantity");
      return;
    }
    setLoading(true);

    const res = await fetch("/api/investments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "paper",
        symbol: row.symbol,
        exchange: row.exchange,
        currency: row.currency,
        name: row.name,
        quantity,
        purchaseDate,
        purchasePrice: purchasePrice || null,
        notes: notes || null,
      }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Buy failed" }));
      toast.error(error ?? "Buy failed");
      setLoading(false);
      return;
    }

    if (removeAfter) {
      await fetch(`/api/watchlist/${row.id}`, { method: "DELETE" });
    }

    toast.success(`Paper-bought ${quantity} ${row.symbol}`);
    mutate("/api/investments");
    mutate("/api/watchlist");
    onOpenChange(false);
    setLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            What-if buy {row.symbol}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {row.name}
            </span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Lands in the Paper trades (what-if) panel — kept separate from your
          real holdings.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="buy-qty">Shares</Label>
              <Input
                id="buy-qty"
                type="number"
                step="0.000001"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="buy-date">Purchase date</Label>
              <Input
                id="buy-date"
                type="date" min="1900-01-01" max="2099-12-31"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <Label className="text-xs" htmlFor="buy-price">
              Price per share (blank = auto from market)
            </Label>
            <Input
              id="buy-price"
              type="number"
              step="0.000001"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="auto"
            />
          </div>
          <div>
            <Label className="text-xs" htmlFor="buy-notes">Notes</Label>
            <Input
              id="buy-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
            <input
              type="checkbox"
              checked={removeAfter}
              onChange={(e) => setRemoveAfter(e.target.checked)}
              className="cursor-pointer accent-indigo-600"
            />
            Remove from watchlist after buying
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "Buying…" : "Buy"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
