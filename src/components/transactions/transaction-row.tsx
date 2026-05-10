"use client";

import { ArrowLeftRight, Lock, StickyNote } from "lucide-react";
import type { ReactNode } from "react";
import { amountClass, cn, formatAUD } from "@/lib/utils";

/** A transaction row tuned for panel/list-shaped contexts (calendar
 * day-detail, sidebars, drawers) — NOT the table-shaped row used by
 * the main /transactions view. Different layout (vertical stack of
 * chips + payee + notes), same data shape and same visual language
 * (account chip colours, reconciled lock, transfer arrow, amount
 * direction colours).
 *
 * If/when the main list is rebuilt as a list-of-rows rather than a
 * <table>, this component is the natural replacement — until then it
 * lives separately so the table-shaped row can keep its column
 * structure, sorting, inline edit, and selection without churn. */

export interface TransactionRowData {
  id: string;
  amount: string;
  payee: string | null;
  description: string | null;
  notes: string | null;
  isReconciled: boolean;
  isTransfer: boolean;
  transferPairId: string | null;
  accountId: string;
  accountName: string;
  accountColor: string;
  categoryId: string | null;
  categoryName: string | null;
  pairAccountName?: string | null;
  pairAccountColor?: string | null;
  pairAmount?: string | null;
  pairPayee?: string | null;
}

export function TransactionRow({
  t,
  showLinkedDetails = true,
  stripeColour,
  trailingSlot,
}: {
  t: TransactionRowData;
  /** Drives whether the linked-counterpart line (transfer arrow + pair
   * chip + pair amount) is rendered. Defaults to true; pass the
   * `transactionsShowLinkedPanel` user pref through to honour the
   * Settings → Display toggle. */
  showLinkedDetails?: boolean;
  /** Optional left-edge accent stripe (e.g. a scheduled-match frequency
   * colour) drawn via inset box-shadow so it doesn't shift layout. */
  stripeColour?: string;
  /** Inline content rendered next to the payee line — typically the
   * ScheduledMatchPill for matched recurring occurrences. */
  trailingSlot?: ReactNode;
}) {
  const linked = !!t.transferPairId;
  return (
    <li
      className="flex justify-between items-start gap-3 py-2 px-2 -mx-2 rounded"
      style={
        stripeColour ? { boxShadow: `inset 3px 0 0 ${stripeColour}` } : undefined
      }
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span
            className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
            style={{ backgroundColor: t.accountColor }}
          >
            {t.accountName}
          </span>
          {t.categoryName && (
            <span className="inline-flex items-center text-[11px] text-muted-foreground shrink-0">
              <span className="text-foreground font-medium">{t.categoryName}</span>
            </span>
          )}
          {t.isReconciled && (
            <Lock
              className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0"
              aria-label="Reconciled"
            />
          )}
        </div>
        <div className="text-sm font-medium leading-tight flex items-center gap-1.5 flex-wrap">
          <span>{t.payee || t.description || "—"}</span>
          {trailingSlot}
        </div>
        {t.notes?.trim() && (
          <div className="flex items-start gap-1.5 text-xs text-muted-foreground pt-0.5">
            <StickyNote
              className="h-3 w-3 text-amber-500 mt-0.5 shrink-0"
              aria-hidden
            />
            <span className="whitespace-pre-wrap">{t.notes}</span>
          </div>
        )}
        {linked && showLinkedDetails && t.pairAccountName && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pt-0.5">
            <ArrowLeftRight
              className="h-3 w-3 shrink-0 text-amber-500/70"
              aria-hidden
            />
            <span
              className="inline-block px-1 py-0.5 rounded text-white text-[9px] whitespace-nowrap"
              style={{ backgroundColor: t.pairAccountColor ?? "#94a3b8" }}
            >
              {t.pairAccountName}
            </span>
            {t.pairPayee && (
              <span className="truncate">{t.pairPayee}</span>
            )}
            {t.pairAmount && (
              <span className={cn("tabular-nums", amountClass(t.pairAmount))}>
                {formatAUD(t.pairAmount)}
              </span>
            )}
          </div>
        )}
      </div>
      <span
        className={cn(
          "shrink-0 font-semibold tabular-nums",
          amountClass(t.amount),
        )}
      >
        {formatAUD(t.amount)}
      </span>
    </li>
  );
}
