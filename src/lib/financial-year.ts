/** Australian financial year runs 1 July – 30 June. These helpers
 * anchor a Date to the FY it sits in; consumers (Reports popover
 * presets, YoY tab, tax flows) all use the same convention. */
export function startOfFinancialYear(d: Date): Date {
  const y = d.getFullYear();
  // getMonth: 0 = January, 6 = July.
  return new Date(d.getMonth() >= 6 ? y : y - 1, 6, 1);
}

export function endOfFinancialYear(d: Date): Date {
  const start = startOfFinancialYear(d);
  // June 30 of the following calendar year.
  return new Date(start.getFullYear() + 1, 5, 30);
}

/** Human-readable label for the FY containing `d` — e.g. "FY26"
 * for any date between 2025-07-01 and 2026-06-30. */
export function financialYearLabel(d: Date): string {
  const endYear = endOfFinancialYear(d).getFullYear();
  return `FY${String(endYear).slice(-2)}`;
}
