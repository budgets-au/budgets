import { Topbar } from "@/components/layout/topbar";
import { ImportView } from "@/components/import/import-view";

export default async function ImportPage() {
  return (
    <div>
      <Topbar title="Import Transactions" />
      <div className="p-4 lg:p-6 space-y-4">
        <ImportView />
      </div>
    </div>
  );
}
