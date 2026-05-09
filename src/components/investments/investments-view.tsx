"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { mutate } from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, Pencil, TrendingUp, Gift, Zap, Eye, Dices } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { formatAUD, formatDate, amountClass } from "@/lib/utils";
import { InvestmentDetailPanel } from "./investment-detail-panel";
import { EditInvestmentDialog } from "./edit-investment-dialog";
import { WatchlistDetailPanel } from "./watchlist-detail-panel";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ListRow {
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
  serviceDate: string | null;
  maturationDate: string | null;
  notes: string | null;
  vestedQuantity: number;
  currentPrice: number | null;
  priorClose: number | null;
  weekAgoClose: number | null;
  costBasis: number;
  currentValue: number;
  totalReturnAbs: number;
  totalReturnPct: number | null;
}

const KIND_GROUPS: { kind: string; label: string; Icon: typeof TrendingUp }[] = [
  { kind: "stock", label: "Stocks", Icon: TrendingUp },
  { kind: "rsu", label: "RSUs", Icon: Gift },
  { kind: "option", label: "Options", Icon: Zap },
  { kind: "paper", label: "Paper trades (what-if)", Icon: Dices },
];

interface WatchRow {
  id: string;
  symbol: string;
  exchange: string;
  name: string | null;
  currency: string;
  notes: string | null;
  currentPrice: number | null;
}

type Selection =
  | { kind: "investment"; id: string }
  | { kind: "watch"; id: string }
  | null;

export function InvestmentsView() {
  const { data: rows = [], isLoading } = useSWR<ListRow[]>("/api/investments", fetcher);
  const { data: watchRows = [] } = useSWR<WatchRow[]>("/api/watchlist", fetcher);
  const [selection, setSelection] = useState<Selection>(null);
  // Auto-select the top stock by currentValue on first load so the detail
  // panel populates immediately. One-shot via a ref — if the user later
  // deselects, we don't keep snapping back. Falls back to the highest-
  // valued investment of any kind if no `stock`-kind row is present;
  // skipped entirely once the user makes their own selection.
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current || selection) return;
    if (rows.length === 0) return;
    const stocks = rows.filter((r) => r.kind === "stock");
    const pool = stocks.length > 0 ? stocks : rows;
    const top = pool.reduce(
      (best, r) => (r.currentValue > best.currentValue ? r : best),
      pool[0],
    );
    if (top) {
      setSelection({ kind: "investment", id: top.id });
      didAutoSelectRef.current = true;
    }
  }, [rows, selection]);

  const selectedInvestmentId =
    selection?.kind === "investment" ? selection.id : null;
  const selectedWatchId = selection?.kind === "watch" ? selection.id : null;
  const selectedWatchRow = selectedWatchId
    ? watchRows.find((r) => r.id === selectedWatchId) ?? null
    : null;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-12 text-center">Loading…</p>;
  }
  if (rows.length === 0 && watchRows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground text-sm">
          No investments yet. Click <strong>Add Investment</strong> to track your first
          stock, RSU grant, or option grant.
        </CardContent>
      </Card>
    );
  }

  // Totals split per kind, then by currency within each kind so a mixed
  // AUD + USD portfolio doesn't FX-add silently.
  const grouped = KIND_GROUPS.map((g) => {
    // Newest first; oldest sits at the bottom of each table. Same date column
    // is bought-on for stocks and granted-on for rsu/option, so sort by it
    // for every kind.
    const kindRows = rows
      .filter((r) => r.kind === g.kind)
      .slice()
      .sort((a, b) => (a.purchaseDate < b.purchaseDate ? 1 : -1));
    const totalsByCurrency = new Map<string, { cost: number; value: number }>();
    for (const r of kindRows) {
      const cur = totalsByCurrency.get(r.currency) ?? { cost: 0, value: 0 };
      cur.cost += r.costBasis;
      cur.value += r.currentValue;
      totalsByCurrency.set(r.currency, cur);
    }
    return { ...g, rows: kindRows, totalsByCurrency };
  }).filter((g) => g.rows.length > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:flex-1 lg:min-h-0">
      <div className="space-y-4 lg:overflow-y-auto lg:min-h-0">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {grouped.map((g) => (
            <KindTotalsCard
              key={`totals-${g.kind}`}
              label={g.label}
              Icon={g.Icon}
              totalsByCurrency={g.totalsByCurrency}
            />
          ))}
        </div>

        {grouped.map((g) => (
          <InvestmentTable
            key={g.kind}
            label={g.label}
            Icon={g.Icon}
            kind={g.kind}
            rows={g.rows}
            selectedId={selectedInvestmentId}
            onSelect={(id) =>
              setSelection(
                selectedInvestmentId === id ? null : { kind: "investment", id },
              )
            }
          />
        ))}

        {watchRows.length > 0 && (
          <WatchlistTable
            rows={watchRows}
            selectedId={selectedWatchId}
            onSelect={(id) =>
              setSelection(selectedWatchId === id ? null : { kind: "watch", id })
            }
          />
        )}
      </div>

      <div className="lg:overflow-y-auto lg:min-h-0">
        {selectedInvestmentId ? (
          <InvestmentDetailPanel id={selectedInvestmentId} />
        ) : selectedWatchRow ? (
          <WatchlistDetailPanel
            row={selectedWatchRow}
            onClose={() => setSelection(null)}
          />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              Select a holding or watchlist entry to see its history,
              dividends and vests.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function GainCell({
  current,
  base,
  quantity,
}: {
  current: number | null;
  base: number | null;
  quantity: number;
}) {
  if (current == null || base == null) {
    return (
      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">
        —
      </td>
    );
  }
  const delta = (current - base) * quantity;
  const pct = base !== 0 ? (current - base) / base : null;
  return (
    <td
      className={`px-3 py-2 text-right tabular-nums whitespace-nowrap text-xs ${amountClass(
        delta,
      )}`}
    >
      {delta >= 0 ? "+" : ""}
      {formatAUD(delta).replace("A$", "$")}
      {pct != null && (
        <span className="ml-1 text-[10px]">({(pct * 100).toFixed(1)}%)</span>
      )}
    </td>
  );
}

function KindTotalsCard({
  label,
  Icon,
  totalsByCurrency,
}: {
  label: string;
  Icon: typeof TrendingUp;
  totalsByCurrency: Map<string, { cost: number; value: number }>;
}) {
  const entries = Array.from(totalsByCurrency.entries());
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {label}
        </p>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground mt-2">No holdings yet.</p>
        ) : (
          <div className="mt-1 space-y-1.5">
            {entries.map(([currency, t]) => {
              const ret = t.value - t.cost;
              const pct = t.cost > 0 ? ret / t.cost : null;
              return (
                <div key={currency}>
                  <p className={`text-2xl font-bold ${amountClass(ret)}`}>
                    {formatAUD(ret)}
                    <span className="ml-2 text-[10px] text-muted-foreground font-normal align-middle">
                      {currency}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatAUD(t.value)} value · {formatAUD(t.cost)} cost
                    {pct != null && (
                      <span className="ml-2">({(pct * 100).toFixed(1)}%)</span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InvestmentTable({
  label,
  Icon,
  kind,
  rows,
  selectedId,
  onSelect,
}: {
  label: string;
  Icon: typeof TrendingUp;
  kind: string;
  rows: ListRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? rows.find((r) => r.id === editingId) ?? null : null;
  const isOption = kind === "option";
  // Paper trades behave like stocks — full quantity, single buy date, no
  // vesting concept — even though they live in their own group.
  const isStockLike = kind === "stock" || kind === "paper";
  const qtyLabel = isStockLike ? "Qty" : "Vested / Granted";
  const dateLabel = isStockLike ? "Bought" : "Granted";

  const confirm = useConfirm();
  async function handleDelete(row: ListRow) {
    const ok = await confirm({
      title: "Delete investment",
      description: `Delete ${row.symbol}? This removes its vests too.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const res = await fetch(`/api/investments/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      mutate("/api/investments");
    } else {
      toast.error("Delete failed");
    }
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="px-3 py-2 border-b flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <Icon className="h-3 w-3" />
            {label}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] text-muted-foreground font-medium border-b">
                  <th className="text-left px-3 py-1.5">Symbol</th>
                  <th className="text-right px-3 py-1.5 whitespace-nowrap">{qtyLabel}</th>
                  <th className="text-left px-3 py-1.5 whitespace-nowrap">{dateLabel}</th>
                  {isOption && (
                    <>
                      <th className="text-left px-3 py-1.5 whitespace-nowrap">Service</th>
                      <th className="text-left px-3 py-1.5 whitespace-nowrap">Maturation</th>
                    </>
                  )}
                  <th className="text-right px-3 py-1.5 whitespace-nowrap">Value</th>
                  {isStockLike && (
                    <>
                      <th className="text-right px-3 py-1.5 whitespace-nowrap">Day</th>
                      <th className="text-right px-3 py-1.5 whitespace-nowrap">Week</th>
                    </>
                  )}
                  <th className="text-right px-3 py-1.5 whitespace-nowrap">Return</th>
                  <th className="w-px" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const qty = parseFloat(r.quantity);
                  const qtyDisplay = isStockLike
                    ? qty.toString()
                    : `${r.vestedQuantity} / ${qty}`;
                  const isSelected = selectedId === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => onSelect(r.id)}
                      className={`group cursor-pointer hover:bg-muted/50 ${
                        isSelected ? "bg-indigo-500/15" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium leading-tight">{r.symbol}</div>
                        {r.name && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]">
                            {r.name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {qtyDisplay}
                      </td>
                      <td className="px-3 py-2 text-left text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {formatDate(r.purchaseDate)}
                      </td>
                      {isOption && (
                        <>
                          <td className="px-3 py-2 text-left text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {r.serviceDate ? formatDate(r.serviceDate) : "—"}
                          </td>
                          <td className="px-3 py-2 text-left text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                            {r.maturationDate ? formatDate(r.maturationDate) : "—"}
                          </td>
                        </>
                      )}
                      <td
                        className={`px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium ${
                          r.currentPrice != null ? amountClass(r.currentValue) : "text-muted-foreground"
                        }`}
                      >
                        {r.currentPrice != null ? formatAUD(r.currentValue) : "—"}
                      </td>
                      {isStockLike && (
                        <>
                          <GainCell
                            current={r.currentPrice}
                            base={r.priorClose}
                            quantity={qty}
                          />
                          <GainCell
                            current={r.currentPrice}
                            base={r.weekAgoClose}
                            quantity={qty}
                          />
                        </>
                      )}
                      <td
                        className={`px-3 py-2 text-right tabular-nums whitespace-nowrap text-xs ${
                          r.currentPrice != null ? amountClass(r.totalReturnAbs) : "text-muted-foreground"
                        }`}
                      >
                        {r.currentPrice != null ? (
                          <>
                            {r.totalReturnAbs >= 0 ? "+" : ""}
                            {formatAUD(r.totalReturnAbs).replace("A$", "$")}
                            {r.totalReturnPct != null && (
                              <span className="ml-1 text-[10px]">
                                ({(r.totalReturnPct * 100).toFixed(1)}%)
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-right">
                        <div className="inline-flex gap-0.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(r.id);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                            aria-label={`Edit ${r.symbol}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(r);
                            }}
                            className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-muted lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                            aria-label={`Delete ${r.symbol}`}
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
        </CardContent>
      </Card>
      {editing && (
        <EditInvestmentDialog
          key={editing.id}
          inv={editing}
          open={!!editingId}
          onOpenChange={(next) => {
            if (!next) setEditingId(null);
          }}
        />
      )}
    </>
  );
}

function WatchlistTable({
  rows,
  selectedId,
  onSelect,
}: {
  rows: WatchRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const confirm = useConfirm();
  async function handleDelete(row: WatchRow) {
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
    } else {
      toast.error("Remove failed");
    }
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-3 py-2 border-b flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          <Eye className="h-3 w-3" />
          Watchlist
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-[10px] text-muted-foreground font-medium border-b">
                <th className="text-left px-3 py-1.5">Symbol</th>
                <th className="text-left px-3 py-1.5 whitespace-nowrap">Exchange</th>
                <th className="text-right px-3 py-1.5 whitespace-nowrap">Price</th>
                <th className="w-px" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const isSelected = selectedId === r.id;
                return (
                  <tr
                    key={r.id}
                    onClick={() => onSelect(r.id)}
                    className={`group cursor-pointer hover:bg-muted/50 ${
                      isSelected ? "bg-indigo-500/15" : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium leading-tight">{r.symbol}</div>
                      {r.name && (
                        <div className="text-[10px] text-muted-foreground truncate max-w-[260px]">
                          {r.name}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {r.exchange} · {r.currency}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-medium">
                      {r.currentPrice != null ? (
                        `${r.currency} ${r.currentPrice.toFixed(2)}`
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(r);
                        }}
                        className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-muted lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                        aria-label={`Remove ${r.symbol}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
