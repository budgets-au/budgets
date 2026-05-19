"use client";

import { useMemo, useState } from "react";
import { mutate as globalMutate } from "swr";
import { useSwrJson } from "@/hooks/use-swr-json";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { addDays, format, parseISO } from "date-fns";
import { formatAUD, amountClass } from "@/lib/utils";


interface SourceTxn {
  id: string;
  accountId: string;
  /** Numeric string in the DB shape ("-500.00"). */
  amount: string;
  date: string;
  payee: string | null;
}

interface CandidateTxn {
  id: string;
  accountId: string;
  accountName: string | null;
  accountColor: string | null;
  amount: string;
  date: string;
  payee: string | null;
  transferPairId: string | null;
}

interface AccountLite {
  id: string;
  name: string;
  isExternal: boolean | number;
  isArchived: boolean | number;
}

/** Manually link an unpaired transaction to another transaction as a
 * transfer pair. Opens to a candidate list pre-filtered to
 * unpaired-only, opposite-sign amounts within ±$1 of the source, on
 * other accounts, ±7 days around the source's date. The "show all"
 * toggle relaxes the amount window (useful for fee-adjusted transfers
 * where the destination receives slightly less than was sent). */
export function LinkTransferDialog({
  source,
  open,
  onOpenChange,
  onPaired,
}: {
  source: SourceTxn | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onPaired?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [linking, setLinking] = useState(false);
  const [externalName, setExternalName] = useState("");

  // Existing isExternal accounts feed the autocomplete suggestions on
  // the "Link to external counterparty" section. Case-insensitive name
  // matching in the backend means typing the same name twice
  // (different case) resolves to the same account, but autocomplete
  // makes the consistency obvious.
  const { data: allAccounts = [] } = useSwrJson<AccountLite[]>(
    open ? "/api/accounts" : null,
  );
  const externalAccounts = useMemo(
    () =>
      allAccounts
        .filter((a) => a.isExternal && !a.isArchived)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allAccounts],
  );

  // Pull ±7 days of unpaired transactions around the source date. The
  // candidate list is small enough (typically tens) that client-side
  // filtering is fine; no need for a dedicated endpoint.
  const sourceDate = source ? parseISO(source.date) : null;
  const fromIso = sourceDate ? format(addDays(sourceDate, -7), "yyyy-MM-dd") : "";
  const toIso = sourceDate ? format(addDays(sourceDate, 7), "yyyy-MM-dd") : "";
  const swrKey =
    open && source
      ? `/api/transactions?transfersFilter=none&from=${fromIso}&to=${toIso}&limit=500`
      : null;
  const { data: response } = useSwrJson<{ rows?: CandidateTxn[] } | CandidateTxn[]>(
    swrKey,
  );
  // The endpoint returns either `rows: [...]` or an array depending on
  // the caller's `paginated` flag — accept both shapes defensively.
  const allCandidates: CandidateTxn[] = useMemo(() => {
    if (!response) return [];
    if (Array.isArray(response)) return response;
    return response.rows ?? [];
  }, [response]);

  const sourceAmount = source ? Number(source.amount) : 0;
  const matchingSign = -sourceAmount; // a paired leg has opposite sign

  const candidates = useMemo(() => {
    if (!source) return [];
    const q = query.trim().toLowerCase();
    return allCandidates
      .filter((c) => c.id !== source.id)
      .filter((c) => c.accountId !== source.accountId)
      .filter((c) => c.transferPairId === null)
      .filter((c) => {
        const amt = Number(c.amount);
        if (showAll) return true;
        // Default to opposite-sign + within $1. The 1-dollar slack
        // covers cents-level rounding and small fees on intra-bank
        // transfers; bigger fee scenarios need the "Show all" toggle.
        return Math.sign(amt) === Math.sign(matchingSign)
          && Math.abs(amt - matchingSign) <= 1;
      })
      .filter((c) => {
        if (!q) return true;
        return (
          (c.payee ?? "").toLowerCase().includes(q) ||
          (c.accountName ?? "").toLowerCase().includes(q) ||
          c.amount.includes(q)
        );
      })
      // Most-recent first within the date window — closest in time to
      // the source is more likely the right pair.
      .sort((a, b) => {
        const dateDiff = Math.abs(
          parseISO(a.date).getTime() - parseISO(source.date).getTime(),
        );
        const dateDiffB = Math.abs(
          parseISO(b.date).getTime() - parseISO(source.date).getTime(),
        );
        return dateDiff - dateDiffB;
      });
  }, [allCandidates, source, query, matchingSign, showAll]);

  async function linkTo(candidate: CandidateTxn) {
    if (!source || linking) return;
    setLinking(true);
    const res = await fetch(
      `/api/transactions/${source.id}/transfer-pair`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairId: candidate.id }),
      },
    );
    setLinking(false);
    if (res.ok) {
      toast.success("Transfer linked");
      // Invalidate any /api/transactions cache so the source list +
      // any other open view both pick up the new pair.
      void globalMutate(
        (key) =>
          typeof key === "string" && key.startsWith("/api/transactions"),
        undefined,
        { revalidate: true },
      );
      onPaired?.();
      onOpenChange(false);
      setQuery("");
      setShowAll(false);
      setExternalName("");
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to link");
    }
  }

  async function linkExternal() {
    const name = externalName.trim();
    if (!source || linking || !name) return;
    setLinking(true);
    const res = await fetch(
      `/api/transactions/${source.id}/transfer-pair`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ external: name }),
      },
    );
    setLinking(false);
    if (res.ok) {
      toast.success(`Linked to external · ${name}`);
      void globalMutate(
        (key) =>
          typeof key === "string" &&
          (key.startsWith("/api/transactions") || key === "/api/accounts"),
        undefined,
        { revalidate: true },
      );
      onPaired?.();
      onOpenChange(false);
      setQuery("");
      setShowAll(false);
      setExternalName("");
    } else {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to link");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Link as transfer</DialogTitle>
        </DialogHeader>
        {source ? (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Linking
              </p>
              <p className="mt-0.5">
                <span className="text-muted-foreground">{source.date}</span>{" "}
                · {source.payee ?? "—"} ·{" "}
                <span className={amountClass(source.amount)}>
                  {formatAUD(source.amount)}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by payee, account, or amount…"
                autoFocus
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />
                Show all
              </label>
            </div>
            <div className="max-h-[400px] overflow-y-auto border rounded-md divide-y">
              {candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No matching unpaired transactions in ±7 days.
                  {!showAll &&
                    " Try toggling \"Show all\" to relax the amount filter."}
                </p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => linkTo(c)}
                    disabled={linking}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors flex items-center gap-3 disabled:opacity-50"
                  >
                    <span className="text-muted-foreground tabular-nums w-20 shrink-0">
                      {c.date}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{
                          backgroundColor: c.accountColor ?? "#94a3b8",
                        }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {c.accountName ?? "—"}
                      </span>
                    </span>
                    <span className="flex-1 truncate">{c.payee ?? "—"}</span>
                    <span
                      className={`tabular-nums font-semibold shrink-0 ${amountClass(c.amount)}`}
                    >
                      {formatAUD(c.amount)}
                    </span>
                  </button>
                ))
              )}
            </div>
            {/* External-counterparty fallback. Use when the other leg
                of the transfer lives somewhere we don't import (a
                separate bank, family member, PayPal). Backend
                finds-or-creates an isExternal=true account named after
                the counterparty, mints a synthetic stub there, and
                links both sides via transfer_pair_id. If the user
                later imports the real CSV for that account, the
                import flow reconciles it in place. */}
            <div className="rounded-md border bg-muted/20 px-3 py-2.5 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Or, link to an external counterparty
              </p>
              <p className="text-xs text-muted-foreground">
                When the other side lives in an account you don&apos;t
                import. We&apos;ll create a placeholder there so the
                pair is real — and reconcile it later if you import
                that account&apos;s CSV.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  list="external-counterparty-suggestions"
                  value={externalName}
                  onChange={(e) => setExternalName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && externalName.trim()) {
                      e.preventDefault();
                      void linkExternal();
                    }
                  }}
                  placeholder="Counterparty name — e.g. HSBC savings, Mom, PayPal"
                  maxLength={120}
                />
                <datalist id="external-counterparty-suggestions">
                  {externalAccounts.map((a) => (
                    <option key={a.id} value={a.name} />
                  ))}
                </datalist>
                <Button
                  type="button"
                  onClick={linkExternal}
                  size="sm"
                  variant="indigo"
                  disabled={linking || externalName.trim().length === 0}
                >
                  Link external
                </Button>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={linking}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
