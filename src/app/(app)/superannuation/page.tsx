import { redirect } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { SuperPageBody } from "@/components/super/super-page-body";
import { loadSuperPeople } from "@/lib/super-people";
import { getDisplayPrefs } from "@/lib/display-prefs-server";

export default async function SuperannuationPage() {
  const prefs = await getDisplayPrefs();
  if (!prefs.featureSuper) redirect("/dashboard");
  // Server-rendered initial list so the page doesn't flicker
  // between an empty "+ Add person" state and the actual N people
  // on first paint. The client component subscribes to
  // `/api/super/people` for subsequent updates (add/rename/delete).
  const initialPeople = await loadSuperPeople();
  return (
    <div>
      <Topbar title="Superannuation" />
      <div className="p-4 lg:p-6">
        <SuperPageBody initialPeople={initialPeople} />
      </div>
    </div>
  );
}
