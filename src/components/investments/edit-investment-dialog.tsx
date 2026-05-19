"use client";

import { useState, useEffect } from "react";
import { mutate } from "swr";
import { useSwrJson } from "@/hooks/use-swr-json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { OptionDateInput } from "./option-date-input";


export interface EditableInvestment {
  id: string;
  kind: string;
  symbol: string;
  name: string | null;
  exchange: string;
  currency: string;
  quantity: string;
  purchaseDate: string;
  purchasePrice: string | null;
  strikePrice: string | null;
  expiryDate: string | null;
  serviceDate: string | null;
  notes: string | null;
}

interface VestRow {
  id: string;
  vestDate: string;
  quantity: string;
  performanceNote: string | null;
  isSatisfied: boolean;
}

interface DetailResponse extends EditableInvestment {
  vests: VestRow[];
}

export function EditInvestmentDialog({
  inv,
  open,
  onOpenChange,
}: {
  inv: EditableInvestment;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const isOption = inv.kind === "option";

  // Fetch vests so we can edit the maturation date directly. Only when open
  // and only for option/rsu kinds.
  const { data: detail } = useSwrJson<DetailResponse>(
    open && inv.kind !== "stock" ? `/api/investments/${inv.id}` : null,
  );

  const [quantity, setQuantity] = useState(inv.quantity);
  const [purchaseDate, setPurchaseDate] = useState(inv.purchaseDate);
  const [purchasePrice, setPurchasePrice] = useState(inv.purchasePrice ?? "");
  const [strikePrice, setStrikePrice] = useState(inv.strikePrice ?? "");
  const [expiryDate, setExpiryDate] = useState(inv.expiryDate ?? "");
  const [serviceDate, setServiceDate] = useState(inv.serviceDate ?? "");
  const [maturationDate, setMaturationDate] = useState("");
  const [notes, setNotes] = useState(inv.notes ?? "");
  const [loading, setLoading] = useState(false);

  // Pull the latest vest date when the detail finishes loading; that's the
  // maturation date for an LTI grant.
  const latestVest = detail?.vests
    ?.slice()
    .sort((a, b) => (a.vestDate < b.vestDate ? 1 : -1))[0];
  const originalMaturation = latestVest?.vestDate ?? "";

  useEffect(() => {
    setMaturationDate(originalMaturation);
  }, [originalMaturation]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!quantity || parseFloat(quantity) <= 0) {
      toast.error("Enter a positive quantity");
      return;
    }
    setLoading(true);

    // 1. PATCH the investment row.
    const res = await fetch(`/api/investments/${inv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quantity,
        purchaseDate,
        purchasePrice: purchasePrice === "" ? null : purchasePrice,
        strikePrice: isOption && strikePrice !== "" ? strikePrice : null,
        expiryDate: isOption && expiryDate !== "" ? expiryDate : null,
        serviceDate: isOption && serviceDate !== "" ? serviceDate : null,
        notes: notes === "" ? null : notes,
      }),
    });

    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Save failed" }));
      toast.error(error ?? "Save failed");
      setLoading(false);
      return;
    }

    // 2. If maturation changed, sync to the vest table. For LTI grants with a
    // single vest covering the full grant we update the existing vest's date;
    // when there's no vest yet, create one for the full quantity.
    if (inv.kind !== "stock" && maturationDate !== originalMaturation) {
      if (maturationDate === "") {
        // Cleared — delete the latest vest if there is one.
        if (latestVest) {
          await fetch(`/api/investments/vests/${latestVest.id}`, {
            method: "DELETE",
          });
        }
      } else if (latestVest) {
        await fetch(`/api/investments/vests/${latestVest.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vestDate: maturationDate }),
        });
      } else {
        await fetch(`/api/investments/${inv.id}/vests`, {
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
    }

    toast.success("Saved");
    mutate("/api/investments");
    mutate(`/api/investments/${inv.id}`);
    mutate(`/api/investments/${inv.id}/history`);
    onOpenChange(false);
    setLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Edit {inv.symbol}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {inv.name}
            </span>
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {inv.kind} · {inv.exchange} · {inv.currency} · ticker locked (delete and re-add to change)
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="edit-qty">
                {inv.kind === "stock" ? "Shares" : "Units granted"}
              </Label>
              <Input
                id="edit-qty"
                type="number"
                step="0.000001"
                min="0"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-pdate">
                {inv.kind === "stock" ? "Purchase date" : "Grant date"}
              </Label>
              <Input
                id="edit-pdate"
                type="date" min="1900-01-01" max="2099-12-31"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <Label className="text-xs" htmlFor="edit-pprice">
              {inv.kind === "stock" ? "Purchase price (per share)" : "Cost per unit"}
            </Label>
            <Input
              id="edit-pprice"
              type="number"
              step="0.000001"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder={inv.kind === "rsu" ? "0 (typical)" : ""}
            />
          </div>

          {isOption && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs" htmlFor="edit-service">
                    Service period date
                  </Label>
                  <OptionDateInput
                    id="edit-service"
                    value={serviceDate}
                    onChange={setServiceDate}
                    baseDate={purchaseDate}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    End of the service period (e.g. 1y after grant)
                  </p>
                </div>
                <div>
                  <Label className="text-xs" htmlFor="edit-maturation">
                    Maturation date
                  </Label>
                  <OptionDateInput
                    id="edit-maturation"
                    value={maturationDate}
                    onChange={setMaturationDate}
                    baseDate={purchaseDate}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    When the grant becomes yours (writes to the vest schedule)
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs" htmlFor="edit-strike">
                    Strike / hurdle (optional)
                  </Label>
                  <Input
                    id="edit-strike"
                    type="number"
                    step="0.000001"
                    value={strikePrice}
                    onChange={(e) => setStrikePrice(e.target.value)}
                    placeholder="blank for performance rights"
                  />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="edit-expiry">
                    Expiry (optional)
                  </Label>
                  <OptionDateInput
                    id="edit-expiry"
                    value={expiryDate}
                    onChange={setExpiryDate}
                    baseDate={purchaseDate}
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Traditional options only
                  </p>
                </div>
              </div>
            </>
          )}

          <div>
            <Label className="text-xs" htmlFor="edit-notes">
              Notes
            </Label>
            <Input
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
