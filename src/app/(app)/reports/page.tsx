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
      <div className="p-4 lg:p-6">
        <ReportsView accounts={allAccounts} />
      </div>
    </div>
  );
}
