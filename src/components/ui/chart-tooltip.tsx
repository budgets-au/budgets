"use client";

import type { ReactNode } from "react";

/** Shared visual container for Recharts custom tooltips. Mirrors
 * the site's Popover cards (rounded-md / border / bg-popover /
 * shadow-md / 12px text / tabular-nums for numbers). Use with
 * Recharts' `<Tooltip content={<MyTooltip />} />` pattern — your
 * component fills in the content rows, this wrapper handles the
 * styling so every chart in the app feels native instead of like
 * a raw Recharts widget.
 *
 * Example:
 *
 *   <ChartTooltipCard>
 *     <ChartTooltipHeader title="May '26" status="matched" statusLabel="Matched" />
 *     <ChartTooltipRow label="Actual" value={formatAUD(123)} />
 *     <ChartTooltipRow label="Planned" value={formatAUD(150)} />
 *     <ChartTooltipRow label="Under" value="−$27.00" tone="positive" />
 *   </ChartTooltipCard>
 */
export function ChartTooltipCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-md border bg-popover text-popover-foreground shadow-md px-3 py-2 text-xs space-y-1 min-w-[10rem] ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** Optional header row: bold title (e.g. the hovered date or label)
 * with an optional status pill on the right. */
export function ChartTooltipHeader({
  title,
  status,
  statusLabel,
  subtitle,
}: {
  title: ReactNode;
  status?: "matched" | "missed" | "forecast" | "neutral";
  statusLabel?: string;
  subtitle?: ReactNode;
}) {
  const statusTone =
    status === "matched"
      ? "text-emerald-600"
      : status === "missed"
        ? "text-red-500"
        : status === "forecast"
          ? "text-muted-foreground"
          : "text-muted-foreground";
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium text-foreground">{title}</span>
        {statusLabel && (
          <span className={`text-[10px] uppercase tracking-wider ${statusTone}`}>
            {statusLabel}
          </span>
        )}
      </div>
      {subtitle && (
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {subtitle}
        </div>
      )}
    </>
  );
}

/** A single label/value pair. Optionally a coloured swatch on the
 * left (matches the line/bar series colour) and a tone hint on the
 * value (positive = green, negative = red, neutral = default). */
export function ChartTooltipRow({
  label,
  value,
  tone = "neutral",
  swatch,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "neutral" | "positive" | "negative" | "muted";
  swatch?: string;
}) {
  const toneCls =
    tone === "positive"
      ? "text-emerald-600 font-medium"
      : tone === "negative"
        ? "text-red-500 font-medium"
        : tone === "muted"
          ? "text-muted-foreground"
          : "";
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {swatch && (
          <span
            className="inline-block h-2 w-2 rounded-sm shrink-0"
            style={{ backgroundColor: swatch }}
          />
        )}
        {label}
      </span>
      <span className={`tabular-nums ${toneCls}`}>{value}</span>
    </div>
  );
}

/** Optional divider between header and rows (or between row groups). */
export function ChartTooltipDivider() {
  return <div className="border-t -mx-3" />;
}
