import { Topbar } from "@/components/layout/topbar";
import { InvestmentsView } from "@/components/investments/investments-view";
import { AddInvestmentButton } from "@/components/investments/add-investment-dialog";

export default async function InvestmentsPage() {
  return (
    <div className="lg:h-screen lg:flex lg:flex-col">
      <Topbar title="Investments" actions={<AddInvestmentButton />} />
      <div className="p-4 lg:p-6 space-y-4 lg:flex-1 lg:min-h-0 lg:overflow-hidden lg:flex lg:flex-col lg:space-y-0">
        <InvestmentsView />
      </div>
    </div>
  );
}
