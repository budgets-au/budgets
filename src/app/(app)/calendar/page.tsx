import { Topbar } from "@/components/layout/topbar";
import { CashflowCalendar } from "@/components/calendar/cashflow-calendar";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export default async function CalendarPage() {
  const allAccounts = await db
    .select({ id: accounts.id, name: accounts.name, color: accounts.color })
    .from(accounts)
    .where(eq(accounts.isArchived, false));

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Topbar title="Cash Flow Calendar" />
      <div className="flex-1 min-h-0 p-3 lg:p-4">
        <CashflowCalendar accounts={allAccounts} />
      </div>
    </div>
  );
}
