import { Topbar } from "@/components/layout/topbar";
import { SuperView } from "@/components/super/super-view";

export default async function SuperannuationPage() {
  return (
    <div>
      <Topbar title="Superannuation" />
      <div className="p-4 lg:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SuperView person="self" />
          <SuperView person="partner" />
        </div>
      </div>
    </div>
  );
}
