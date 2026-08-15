import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface RankedRow {
  /** Stable key + implicit anchor label for the row. */
  id: string;
  /** Left column — usually a category / payee display name. */
  label: string;
  /** Right column — primary metric (formatted string). */
  metric: string;
  /** Optional tinted class for the metric (e.g. amountClass or a
   *  MONEY_POSITIVE_CLASS constant). */
  metricClass?: string;
  /** Optional secondary line under the label. */
  hint?: string;
  /** Optional badge on the right of the row (e.g. "3 mo streak"). */
  badge?: string;
  badgeClass?: string;
}

/** Ranked-list card — a titled card with a short list of `label /
 *  metric` rows. Used by the Trends / Anomaly report for its four
 *  panels. Renders an EmptyMessage inline when the row list is
 *  empty rather than an empty card body. */
export function RankedList({
  title,
  description,
  rows,
  emptyMessage,
  footer,
}: {
  title: string;
  description?: string;
  rows: RankedRow[];
  emptyMessage: string;
  /** Optional footer node (e.g. "showing top 5"). */
  footer?: ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">{emptyMessage}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/50">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{r.label}</div>
                  {r.hint && (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {r.hint}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.badge && (
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        r.badgeClass ?? "bg-muted text-muted-foreground"
                      }`}
                    >
                      {r.badge}
                    </span>
                  )}
                  <span
                    className={`text-sm tabular-nums whitespace-nowrap ${r.metricClass ?? ""}`}
                  >
                    {r.metric}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {footer && (
          <div className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
            {footer}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
