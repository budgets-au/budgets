import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MONEY_POSITIVE_CLASS, MONEY_NEGATIVE_CLASS } from "@/lib/utils";

/** Overview stat tile — big number + label + optional MoM delta pill
 *  and target hint. Used by the Financial Health report's top row and
 *  potentially other overview surfaces. Kept intentionally minimal
 *  (no charts, no interactivity) so a row of 4 renders quickly at
 *  first paint. */
export function StatTile({
  label,
  value,
  hint,
  delta,
  goodDirection = "up",
  loading = false,
}: {
  /** Short caption above the value. */
  label: string;
  /** Preformatted display string — `$1,234`, `4.2 months`, `18.5%`. */
  value: string;
  /** Optional secondary line — e.g. "Target: 20%" or "vs. last month". */
  hint?: string;
  /** Signed month-over-month change as a fraction (0.05 → +5%).
   *  Absent when the tile has no meaningful prior period to compare
   *  (e.g. first-run ledger, one-month window). */
  delta?: number | null;
  /** Which direction reads as "good" — savings rate up is good;
   *  debt-to-income up is bad. Only affects the delta pill colour. */
  goodDirection?: "up" | "down";
  loading?: boolean;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-1 py-1">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="font-heading text-2xl leading-tight tabular-nums">
          {loading ? (
            <span className="text-muted-foreground/40">—</span>
          ) : (
            value
          )}
        </span>
        <div className="flex items-center justify-between gap-2">
          {hint ? (
            <span className="text-[11px] text-muted-foreground">{hint}</span>
          ) : (
            <span />
          )}
          {delta !== undefined && delta !== null && !loading && (
            <DeltaPill delta={delta} goodDirection={goodDirection} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DeltaPill({
  delta,
  goodDirection,
}: {
  delta: number;
  goodDirection: "up" | "down";
}) {
  const isZero = Math.abs(delta) < 0.0005;
  const isUp = delta > 0;
  const positive = goodDirection === "up" ? isUp : !isUp;
  const cls = isZero
    ? "text-muted-foreground"
    : positive
      ? MONEY_POSITIVE_CLASS
      : MONEY_NEGATIVE_CLASS;
  const Icon = isZero ? Minus : isUp ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium tabular-nums ${cls}`}>
      <Icon className="h-3 w-3" />
      {isZero ? "0%" : `${(Math.abs(delta) * 100).toFixed(1)}%`}
    </span>
  );
}
