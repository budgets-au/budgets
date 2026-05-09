import type { TaxConfig } from "@/db/schema";
import { buildCategoryMeta, type CategoryLike } from "@/lib/category-path";
import {
  BUNDLED_CATEGORY_PATTERNS,
  OTHER_DEDUCTION_HINTS,
  rateForFy,
} from "./ato-rates";

export interface TaxTxn {
  /** Signed amount: expenses negative, refunds positive. */
  amount: number;
  categoryId: string | null;
}

export interface TaxCategoryRow {
  categoryId: string;
  path: string[];
  /** |sum of signed amounts| — refunds reduce the magnitude. */
  total: number;
  workUsePct: number;
  claimable: number;
}

export interface OtherDeductionRow extends TaxCategoryRow {
  section: "donations" | "tax-agent" | "subscriptions" | "other";
}

export interface TaxReport {
  fyEndYear: number;
  fyRange: { from: string; to: string };
  ratePerHour: number;
  hours: number;
  wfh: {
    fixed: { claim: number; rate: number; hours: number };
    actual: {
      claim: number;
      categories: TaxCategoryRow[];
    };
    recommended: "fixed" | "actual";
  };
  otherDeductions: OtherDeductionRow[];
  summary: { wfhClaim: number; otherClaim: number; total: number };
  warnings: string[];
}

/** Auto-classify a category for default treatment based on its full path.
 * Used the first time the user opens the report — they can override after. */
export function classifyCategoryDefault(
  path: string[],
): {
  bundledInWfh: boolean;
  section: "donations" | "tax-agent" | "subscriptions" | "other" | null;
  defaultPct: number;
} {
  const joined = path.join(" / ");
  const bundled = BUNDLED_CATEGORY_PATTERNS.some((re) => re.test(joined));
  for (const hint of OTHER_DEDUCTION_HINTS) {
    if (hint.patterns.some((re) => re.test(joined))) {
      return { bundledInWfh: bundled, section: hint.section, defaultPct: hint.defaultPct };
    }
  }
  return { bundledInWfh: bundled, section: null, defaultPct: 0 };
}

interface CalcInput {
  fyEndYear: number;
  fyRange: { from: string; to: string };
  config: TaxConfig;
  categories: CategoryLike[];
  /** Already filtered to the FY date range and the active account scope. */
  txns: TaxTxn[];
}

export function calculateTaxReport(input: CalcInput): TaxReport {
  const { fyEndYear, fyRange, config, categories, txns } = input;
  const { meta } = buildCategoryMeta(categories);
  const warnings: string[] = [];

  // Sum signed amounts per category, then |x| for display. Refunds (positive
  // entries on expense categories) shrink the deductible total.
  const signedTotalByCat = new Map<string, number>();
  for (const t of txns) {
    if (!t.categoryId) continue;
    signedTotalByCat.set(
      t.categoryId,
      (signedTotalByCat.get(t.categoryId) ?? 0) + t.amount,
    );
  }

  const { rate, fallback } = rateForFy(fyEndYear);
  if (fallback) {
    warnings.push(
      `No published ATO fixed rate for ${fyEndYear}; using the most recent known rate of $${rate.toFixed(2)}/hr. Confirm before lodging.`,
    );
  }

  const hours = config.wfhHoursByFy?.[fyEndYear] ?? 0;
  if (hours <= 0) {
    warnings.push(
      `No WFH hours recorded for FY${String(fyEndYear - 1).slice(2)}/${String(fyEndYear).slice(2)} — fixed-rate claim is $0.`,
    );
  }

  const fixedClaim = +(rate * hours).toFixed(2);

  // Walk every category that has either a signed total or a config rule, then
  // bucket into: WFH-actual (workUsePct>0 AND bundledInWfh), other (section
  // hint or workUsePct>0 AND not bundled), excluded (overlap warning).
  const wfhActualRows: TaxCategoryRow[] = [];
  const otherRows: OtherDeductionRow[] = [];
  const seen = new Set<string>();
  const candidates = new Set<string>([
    ...signedTotalByCat.keys(),
    ...Object.keys(config.categoryRules ?? {}),
  ]);

  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    const m = meta.get(id);
    if (!m) continue;
    const rule = config.categoryRules?.[id];
    const auto = classifyCategoryDefault(m.path);
    const workUsePct = rule?.workUsePct ?? auto.defaultPct;
    const bundled = rule?.bundledInWfh ?? auto.bundledInWfh;
    const signed = signedTotalByCat.get(id) ?? 0;
    const total = Math.abs(signed);
    if (total === 0 && workUsePct === 0) continue;
    const claimable = +((total * workUsePct) / 100).toFixed(2);

    if (bundled) {
      // Belongs to the WFH bundle. Under actual-cost, contributes via
      // workUsePct; under fixed-rate, it's already covered and excluded.
      wfhActualRows.push({ categoryId: id, path: m.path, total, workUsePct, claimable });
      if (workUsePct > 0) {
        // No-op: bundled rows naturally claim only when workUsePct>0; if the
        // user has set a pct AND bundled=true, that's the intended actual
        // calculation. The "overlap" warning is reserved for the fixed-rate
        // path where the same category would double-count if not excluded.
      }
    } else if (workUsePct > 0) {
      otherRows.push({
        categoryId: id,
        path: m.path,
        total,
        workUsePct,
        claimable,
        section: auto.section ?? "other",
      });
    }
  }

  const actualClaim = +wfhActualRows
    .reduce((s, r) => s + r.claimable, 0)
    .toFixed(2);

  const recommended: "fixed" | "actual" = actualClaim > fixedClaim ? "actual" : "fixed";

  // Stable ordering: sections first (tax-agent, donations, subscriptions, other),
  // then by path within section.
  const sectionOrder: Record<OtherDeductionRow["section"], number> = {
    "tax-agent": 0,
    donations: 1,
    subscriptions: 2,
    other: 3,
  };
  otherRows.sort((a, b) => {
    const s = sectionOrder[a.section] - sectionOrder[b.section];
    if (s !== 0) return s;
    return a.path.join(" / ").localeCompare(b.path.join(" / "));
  });
  wfhActualRows.sort((a, b) => a.path.join(" / ").localeCompare(b.path.join(" / ")));

  const otherClaim = +otherRows.reduce((s, r) => s + r.claimable, 0).toFixed(2);
  const wfhClaim = recommended === "fixed" ? fixedClaim : actualClaim;
  const total = +(wfhClaim + otherClaim).toFixed(2);

  return {
    fyEndYear,
    fyRange,
    ratePerHour: rate,
    hours,
    wfh: {
      fixed: { claim: fixedClaim, rate, hours },
      actual: { claim: actualClaim, categories: wfhActualRows },
      recommended,
    },
    otherDeductions: otherRows,
    summary: { wfhClaim, otherClaim, total },
    warnings,
  };
}
