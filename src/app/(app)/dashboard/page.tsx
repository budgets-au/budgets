import { auth } from "@/lib/auth";
import { Topbar } from "@/components/layout/topbar";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";

/** Thin server shell. All data lives in widget components (SWR
 * against the same routes the rest of the app uses), so the page
 * itself only needs to gate on auth and hand off to the editable
 * grid. */
export default async function DashboardPage() {
  await auth();
  return (
    <div>
      <Topbar title="Dashboard" />
      <DashboardGrid />
    </div>
  );
}
