import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { SessionProvider } from "@/components/layout/session-provider";
import { MustChangePasswordBanner } from "@/components/layout/must-change-password-banner";
import { ConfirmDialogProvider } from "@/hooks/use-confirm-dialog";
import { AddCategoryProvider } from "@/hooks/use-add-category-dialog";
import { AddAccountProvider } from "@/hooks/use-add-account-dialog";
import { AddScheduledProvider } from "@/hooks/use-add-scheduled-dialog";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <SessionProvider>
      <ConfirmDialogProvider>
        <AddCategoryProvider>
        <AddAccountProvider>
        <AddScheduledProvider>
        <div className="flex min-h-screen bg-muted/30">
          <Sidebar />
          {/* min-w-0 / min-w-0 down the chain: flex children default to
              min-width: auto on Safari, so a wide child (e.g. the
              transactions table) pushes the column past the viewport
              instead of triggering its overflow-x-auto wrapper. Caps
              the content column to its flex-allotted width. */}
          <div className="flex-1 min-w-0 lg:ml-60 flex flex-col min-h-screen">
            <MustChangePasswordBanner />
            <main className="flex-1 min-w-0 pt-14 lg:pt-0">{children}</main>
          </div>
        </div>
        </AddScheduledProvider>
        </AddAccountProvider>
        </AddCategoryProvider>
      </ConfirmDialogProvider>
    </SessionProvider>
  );
}
