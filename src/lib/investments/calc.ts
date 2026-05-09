import type { Investment, InvestmentVest } from "@/db/schema";

const num = (s: string | null | undefined): number =>
  s == null ? 0 : parseFloat(s);

/**
 * Total quantity that has vested as of `today` (defaults to now).
 *
 * - Stocks always return their full quantity.
 * - Paper trades default to fully vested when no vest rows exist (a plain
 *   what-if buy doesn't need a schedule). When the user has added vests to
 *   simulate an LTI-style what-if, the schedule wins and we respect it.
 * - RSU/option always use the schedule (sum vests with date ≤ today and
 *   is_satisfied = true).
 */
export function vestedQuantity(
  inv: Pick<Investment, "kind" | "quantity">,
  vests: Pick<InvestmentVest, "vestDate" | "quantity" | "isSatisfied">[],
  today: Date = new Date(),
): number {
  if (inv.kind === "stock") return num(inv.quantity);
  if (inv.kind === "paper" && vests.length === 0) return num(inv.quantity);
  const todayISO = today.toISOString().slice(0, 10);
  return vests
    .filter((v) => v.isSatisfied && v.vestDate <= todayISO)
    .reduce((sum, v) => sum + num(v.quantity), 0);
}

/**
 * Cost basis = quantity × purchase_price. RSUs treat null purchase_price
 * as 0 (they vest "for free"); options treat it as the strike (cost to
 * exercise) but we use strike_price separately for intrinsic-value calc.
 */
export function costBasis(
  inv: Pick<Investment, "kind" | "quantity" | "purchasePrice">,
): number {
  const qty = num(inv.quantity);
  const price =
    inv.kind === "rsu"
      ? num(inv.purchasePrice) // null/0 for typical grants
      : num(inv.purchasePrice);
  return qty * price;
}

/**
 * Current market value of the position at today's price. Stocks: full
 * quantity × price. RSU/option: full granted quantity × price (what the
 * grant is worth if it all matured today). When a strike price is set on
 * an option row (traditional financial option), value drops to intrinsic
 * `max(0, current − strike) × qty`. The vested-only view is exposed by
 * the caller via `vestedQty` for the per-row "Vested" display.
 */
export function currentValue(
  inv: Pick<Investment, "kind" | "quantity" | "strikePrice">,
  currentPrice: number,
): number {
  const qty = num(inv.quantity);
  if (inv.kind === "stock") return qty * currentPrice;
  const strike = num(inv.strikePrice);
  if (strike > 0) return Math.max(0, currentPrice - strike) * qty;
  return qty * currentPrice;
}

/**
 * Sum of dividend payments received: for each ex-date dividend event, multiply
 * the per-share amount by the holding's quantity on that date. We don't track
 * historical quantity changes, so for stocks this is `qty × Σ div` where qty
 * is the (current) quantity. For RSUs/options, dividends accrue only on the
 * vested portion as of each ex-date.
 */
export function dividendsReceived(
  inv: Pick<Investment, "kind" | "purchaseDate">,
  vests: Pick<InvestmentVest, "vestDate" | "quantity" | "isSatisfied">[],
  quantity: number,
  events: { date: string; amount: number }[],
): number {
  const noSchedule = inv.kind === "paper" && vests.length === 0;
  return events
    .filter((e) => e.date >= inv.purchaseDate) // ignore dividends before holding existed
    .reduce((sum, e) => {
      if (inv.kind === "stock" || noSchedule) return sum + quantity * e.amount;
      // For rsu/option/paper-with-vests, only count vested-as-of ex-date.
      const qtyAtExDate = vests
        .filter((v) => v.isSatisfied && v.vestDate <= e.date)
        .reduce((s, v) => s + num(v.quantity), 0);
      return sum + qtyAtExDate * e.amount;
    }, 0);
}

/**
 * Total return = current value + dividends received − cost basis. Returns
 * absolute (currency) and percentage (relative to cost basis; null when
 * cost basis is 0, e.g. an RSU grant with no purchase price).
 */
export function totalReturn(
  basis: number,
  current: number,
  dividends: number,
): { absolute: number; percent: number | null } {
  const absolute = current + dividends - basis;
  const percent = basis > 0 ? absolute / basis : null;
  return { absolute, percent };
}

/**
 * Intrinsic value of an option position: max(0, currentPrice − strike) × vestedQty.
 * Out-of-the-money options return 0 even if vested.
 */
export function optionIntrinsic(
  inv: Pick<Investment, "kind" | "strikePrice">,
  currentPrice: number,
  vestedQty: number,
): number {
  if (inv.kind !== "option") return 0;
  const strike = num(inv.strikePrice);
  return Math.max(0, currentPrice - strike) * vestedQty;
}
