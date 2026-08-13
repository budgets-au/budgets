import { Topbar } from "@/components/layout/topbar";
import { ReportsView } from "@/components/reports/reports-view";
import { PrintReportButton } from "@/components/reports/print-report-button";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function ReportsPage() {
  const allAccounts = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.isArchived, false));

  return (
    <div>
      <Topbar title="Reports" actions={<PrintReportButton />} />
      {/* /reports stacks TWO filter bars — ReportsView's date-range +
          report picker, then the active report's own toggle bar — so
          the vertical chrome above a table is taller here than the
          180px default `--table-chrome` assumes. Under-reserving made
          the page scroll by the difference, which slid the tables'
          sticky headers up underneath the sticky filter bar. Declared
          per-page, which is what the token exists for. */}
      <div
        className="p-4 lg:p-6"
        style={{ "--table-chrome": "15rem" } as React.CSSProperties}
      >
        <ReportsView accounts={allAccounts} />
      </div>
    </div>
  );
}
