import { auth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

/** Thin server shell. All data lives in widget components (SWR
 * against the same routes the rest of the app uses) and the
 * edit-mode toggle lives in the topbar's actions slot — the page
 * itself only gates on auth and hands off to the client shell. */
export default async function DashboardPage() {
  await auth();
  return (
    <div>
      <DashboardShell />
    </div>
  );
}
