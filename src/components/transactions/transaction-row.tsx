"use client";

import { ArrowLeftRight, Lock, StickyNote } from "lucide-react";
import type { ReactNode } from "react";
import { amountClass, cn, formatAUD } from "@/lib/utils";

/** A transaction row tuned for panel/list-shaped contexts (calendar
 * day-detail, drawers, sidebars) — NOT the table-shaped row used by
 * the main /transactions view. Single horizontal line to match the
 * visual rhythm of the main list (account chip · category · payee
 * · linked · amount), even though it isn't a `<tr>`.
 *
 * Notes — when present — render as a hover-tooltip icon next to the
 * payee, the same affordance the main list uses in compact mode. If
 * an inline notes line is needed, wrap a sibling element below the
 * row at the call site. */

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
  /** Drives whether the linked-counterpart cell (transfer arrow + pair
   * chip + pair amount) is rendered. Defaults to true; pass the
   * `transactionsShowLinkedPanel` user pref through to honour the
   * Settings → Display toggle. */
  showLinkedDetails?: boolean;
  /** Optional left-edge accent stripe (e.g. a scheduled-match frequency
   * colour) drawn via inset box-shadow so it doesn't shift layout. */
  stripeColour?: string;
  /** Inline content rendered next to the payee — typically the
   * ScheduledMatchPill for matched recurring occurrences. */
  trailingSlot?: ReactNode;
}) {
  const linked = !!t.transferPairId;
  return (
    <li
      className="flex items-center gap-3 py-2 px-2 -mx-2 rounded text-sm"
      style={
        stripeColour ? { boxShadow: `inset 3px 0 0 ${stripeColour}` } : undefined
      }
    >
      <span
        className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap shrink-0"
        style={{ backgroundColor: t.accountColor }}
      >
        {t.accountName}
      </span>
      {t.categoryName && (
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {t.categoryName}
        </span>
      )}
      {t.isReconciled && (
        <Lock
          className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0"
          aria-label="Reconciled"
        />
      )}
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="truncate font-medium">
          {t.payee || t.description || "—"}
        </span>
        {t.notes?.trim() && (
          <span
            className="inline-flex shrink-0 cursor-help"
            title={t.notes}
            aria-label={`Note: ${t.notes}`}
          >
            <StickyNote className="h-3 w-3 text-amber-500" />
          </span>
        )}
        {trailingSlot}
      </span>
      {linked && showLinkedDetails && t.pairAccountName && (
        <span className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <ArrowLeftRight
            className="h-3 w-3 text-amber-500/70"
            aria-hidden
          />
          <span
            className="inline-block px-1 py-0.5 rounded text-white text-[9px] whitespace-nowrap"
            style={{ backgroundColor: t.pairAccountColor ?? "#94a3b8" }}
          >
            {t.pairAccountName}
          </span>
          {t.pairAmount && (
            <span className={cn("tabular-nums", amountClass(t.pairAmount))}>
              {formatAUD(t.pairAmount)}
            </span>
          )}
        </span>
      )}
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
