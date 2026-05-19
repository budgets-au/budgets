"use client";

import { useState, useEffect } from "react";
import { mutate } from "swr";
import { useSwrJson } from "@/hooks/use-swr-json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, TrendingUp, Gift, Zap, Eye } from "lucide-react";
import { toast } from "sonner";
import { OptionDateInput } from "./option-date-input";


interface SearchResult {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
}

type Kind = "stock" | "rsu" | "option" | "watch";

export function AddInvestmentButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="indigo" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4 mr-1" /> Add Investment
      </Button>
      <AddInvestmentDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function AddInvestmentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [kind, setKind] = useState<Kind>("stock");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<SearchResult | null>(null);
  const [quantity, setQuantity] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [purchasePrice, setPurchasePrice] = useState("");
  const [strikePrice, setStrikePrice] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [serviceDate, setServiceDate] = useState("");
  const [maturationDate, setMaturationDate] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // Debounce the autocomplete fetch — typing "AAPL" shouldn't issue 4 calls.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: searchResults = [], isLoading: searching } = useSwrJson<SearchResult[]>(
    open && debounced.length >= 1 && !picked
      ? `/api/investments/search?q=${encodeURIComponent(debounced)}`
      : null,
  );

  function reset() {
    setKind("stock");
    setQuery("");
    setDebounced("");
    setPicked(null);
    setQuantity("");
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setPurchasePrice("");
    setStrikePrice("");
    setExpiryDate("");
    setServiceDate("");
    setMaturationDate("");
    setNotes("");
    setLoading(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) {
      toast.error("Pick a ticker from the search results");
      return;
    }
    if (kind !== "watch" && (!quantity || parseFloat(quantity) <= 0)) {
      toast.error("Enter a positive quantity");
      return;
    }
    setLoading(true);

    // Watch is its own resource (no quantity, no cost basis); routes to a
    // separate endpoint.
    if (kind === "watch") {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: picked.symbol,
          exchange: picked.exchange,
          currency: picked.currency,
          name: picked.name,
          notes: notes || null,
        }),
      });
      if (res.ok) {
        toast.success("Added to watchlist");
        mutate("/api/watchlist");
        handleOpenChange(false);
      } else {
        const { error } = await res.json().catch(() => ({ error: "Save failed" }));
        toast.error(error ?? "Save failed");
        setLoading(false);
      }
      return;
    }

    const res = await fetch("/api/investments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        symbol: picked.symbol,
        exchange: picked.exchange,
        currency: picked.currency,
        name: picked.name,
        quantity,
        purchaseDate,
        purchasePrice: purchasePrice || null,
        strikePrice: kind === "option" && strikePrice ? strikePrice : null,
        expiryDate: kind === "option" && expiryDate ? expiryDate : null,
        serviceDate: kind === "option" && serviceDate ? serviceDate : null,
        notes: notes || null,
      }),
    });
    if (res.ok) {
      const created = await res.json();
      // For LTI grants the user typically captures the maturation date as
      // a single vest entry covering the full granted quantity. Auto-create
      // it here so they don't have to open the detail panel separately.
      if (kind === "option" && maturationDate && created.id) {
        await fetch(`/api/investments/${created.id}/vests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vestDate: maturationDate,
            quantity,
            performanceNote: null,
            isSatisfied: true,
          }),
        });
      }
      toast.success("Investment added");
      mutate("/api/investments");
      handleOpenChange(false);
    } else {
      const { error } = await res.json().catch(() => ({ error: "Save failed" }));
      toast.error(error ?? "Save failed");
      setLoading(false);
    }
  }

  const kindOptions: { k: Kind; Icon: typeof TrendingUp; label: string }[] = [
    { k: "stock", Icon: TrendingUp, label: "Stock" },
    { k: "rsu", Icon: Gift, label: "RSU" },
    { k: "option", Icon: Zap, label: "Option" },
    { k: "watch", Icon: Eye, label: "Watch" },
  ];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add investment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          <div>
            <Label className="text-xs">Type</Label>
            <div className="flex gap-1 mt-1">
              {kindOptions.map(({ k, Icon, label }) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs border transition-colors ${
                    kind === k
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-background border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs" htmlFor="ticker-search">
              Ticker {kind === "stock" ? "" : "(underlying symbol)"}
            </Label>
            {picked ? (
              <div className="flex items-center justify-between gap-2 px-2 py-1.5 border rounded bg-muted/30">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {picked.symbol} · {picked.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {picked.exchange} · {picked.currency}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPicked(null);
                    setQuery("");
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input
                  id="ticker-search"
                  placeholder="AAPL or BHP.AX"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoComplete="off"
                />
                {debounced && (
                  <div className="border rounded mt-1 max-h-48 overflow-y-auto">
                    {searching ? (
                      <p className="p-2 text-xs text-muted-foreground">Searching…</p>
                    ) : searchResults.length === 0 ? (
                      <p className="p-2 text-xs text-muted-foreground">No matches</p>
                    ) : (
                      searchResults.map((r) => (
                        <button
                          key={r.symbol}
                          type="button"
                          onClick={() => setPicked(r)}
                          className="w-full text-left px-2 py-1.5 hover:bg-muted text-sm flex justify-between gap-2"
                        >
                          <span className="font-medium truncate">{r.symbol}</span>
                          <span className="text-xs text-muted-foreground truncate">
                            {r.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {r.exchange}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {kind !== "watch" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs" htmlFor="qty">
                  {kind === "stock" ? "Shares" : "Units granted"}
                </Label>
                <Input
                  id="qty"
                  type="number"
                  step="0.000001"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
              </div>
              <div>
                <Label className="text-xs" htmlFor="pdate">
                  {kind === "stock" ? "Purchase date" : "Grant date"}
                </Label>
                <Input
                  id="pdate"
                  type="date" min="1900-01-01" max="2099-12-31"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          {kind === "stock" && (
            <div>
              <Label className="text-xs" htmlFor="pprice">
                Purchase price (per share, blank = auto-fill from market)
              </Label>
              <Input
                id="pprice"
                type="number"
                step="0.000001"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="auto"
              />
            </div>
          )}

          {kind === "option" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs" htmlFor="service">
                    Service period date
                  </Label>
                  <OptionDateInput
                    id="service"
                    value={serviceDate}
                    onChange={setServiceDate}
                    baseDate={purchaseDate}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    e.g. 1y after grant for an LTI award
                  </p>
                </div>
                <div>
                  <Label className="text-xs" htmlFor="maturation">
                    Maturation date
                  </Label>
                  <OptionDateInput
                    id="maturation"
                    value={maturationDate}
                    onChange={setMaturationDate}
                    baseDate={purchaseDate}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Creates a vest of the full grant on this date
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs" htmlFor="strike">
                    Strike / hurdle (optional)
                  </Label>
                  <Input
                    id="strike"
                    type="number"
                    step="0.000001"
                    value={strikePrice}
                    onChange={(e) => setStrikePrice(e.target.value)}
                    placeholder="blank for share grants"
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="expiry">
                    Expiry (optional)
                  </Label>
                  <OptionDateInput
                    id="expiry"
                    value={expiryDate}
                    onChange={setExpiryDate}
                    baseDate={purchaseDate}
                  />
                </div>
              </div>
            </>
          )}

          <div>
            <Label className="text-xs" htmlFor="notes">
              Notes
            </Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading || !picked}>
              {loading ? "Saving…" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
