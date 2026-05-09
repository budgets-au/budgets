/** Australian financial year helpers. The FY runs 1 July → 30 June; we
 * key everything by `fyEndYear` (the calendar year of the closing 30 June),
 * matching the convention already used by `superannuationSnapshots.fyEndYear`. */

/** Returns the closing year of the FY that contains `now`. */
export function currentFyEndYear(now: Date = new Date()): number {
  const y = now.getFullYear();
  // Months 0..5 (Jan..Jun) are in the FY ending this calendar year;
  // months 6..11 (Jul..Dec) are in the FY ending next calendar year.
  return now.getMonth() < 6 ? y : y + 1;
}

/** Inclusive ISO date range covering the entire FY. */
export function fyDateRange(fyEndYear: number): { from: string; to: string } {
  return { from: `${fyEndYear - 1}-07-01`, to: `${fyEndYear}-06-30` };
}

/** Display label like "FY24/25". */
export function formatFy(fyEndYear: number): string {
  return `FY${String(fyEndYear - 1).slice(2)}/${String(fyEndYear).slice(2)}`;
}
