"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Single canonical Print button for the Reports page. Rendered as
 *  an action on the Topbar (left of the profile chip) so it lives
 *  in the same place every report uses, and the per-report bodies
 *  don't sprout their own duplicates.
 *
 *  Triggers `window.print()` — the `@media print` stylesheet hides
 *  everything tagged `data-print-hide` (the Topbar itself, the
 *  date-range filter, the TabsList) so only the active report
 *  panel ends up on paper. */
export function PrintReportButton() {
  return (
    <Button
      variant="indigo"
      size="sm"
      onClick={() => window.print()}
      className="print:hidden"
    >
      <Printer className="h-4 w-4 mr-1.5" />
      Print
    </Button>
  );
}
