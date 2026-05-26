import { formatAUD, cn } from "@/lib/utils";
import type {
  TrigramNeighbour,
  TrigramCategoryRange,
} from "@/lib/categorize";

/** Diagnostic block shared by the CSV-import expand panel and the
 *  transactions-list expand panel. Renders:
 *
 *  - The per-category amount ranges from the wide (top-30)
 *    neighbourhood the suggester scored over. Useful for spotting
 *    "this payee shows up under Groceries when the amount is
 *    small, Bills when it's big".
 *  - The top-5 nearest neighbours (payee + similarity % + amount +
 *    category) so the operator can sanity-check WHY the suggested
 *    category was picked.
 *
 *  Both lists hide themselves when empty; renders a friendly fallback
 *  line when neither has data (e.g. row with no normalisedPayee). */
export function NeighboursPanel({
  neighbours,
  categoryRanges,
}: {
  neighbours: TrigramNeighbour[];
  categoryRanges: TrigramCategoryRange[];
}) {
  const empty = neighbours.length === 0 && categoryRanges.length === 0;
  if (empty) {
    return (
      <p className="text-[10px] text-muted-foreground italic">
        No trigram neighbours — categorise this row manually
        using the picker on the left.
      </p>
    );
  }
  return (
    <>
      {categoryRanges.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Categories in matched neighbourhood
          </p>
          <ul className="mt-1 space-y-0.5">
            {categoryRanges.map((cr, j) => (
              <li
                key={j}
                className={cn(
                  "flex gap-3 items-center",
                  cr.isPicked && "font-medium",
                )}
              >
                <span className="text-muted-foreground w-12 text-right tabular-nums">
                  {cr.support}n
                </span>
                <span className="w-48 truncate">
                  {cr.categoryName ?? "—"}
                  {cr.isPicked && (
                    <span className="ml-1 text-[10px] text-emerald-600">
                      ◀ picked
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {cr.minAmount === cr.maxAmount
                    ? formatAUD(cr.minAmount)
                    : `${formatAUD(cr.minAmount)} – ${formatAUD(cr.maxAmount)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {neighbours.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-2">
            Nearest neighbours
          </p>
          <ul className="mt-1 space-y-0.5">
            {neighbours.map((n, j) => (
              <li key={j} className="flex gap-3">
                <span className="tabular-nums text-muted-foreground w-10">
                  {(n.similarity * 100).toFixed(0)}%
                </span>
                <span
                  className="font-mono text-[11px] truncate max-w-[240px]"
                  title={n.normalizedPayee}
                >
                  {n.normalizedPayee}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatAUD(n.amount)}
                </span>
                <span>{n.categoryName ?? "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
