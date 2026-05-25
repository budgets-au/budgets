import Link from "next/link";
import { asc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { Topbar } from "@/components/layout/topbar";
import { buttonVariants } from "@/components/ui/button";
import { ImportAccountsButton } from "@/components/accounts/import-accounts-button";
import { AccountsList } from "@/components/accounts/accounts-list";
import { cn } from "@/lib/utils";

export default async function AccountsPage() {
  const allAccounts = await db
    .select()
    .from(accounts)
    .orderBy(asc(accounts.name));

  return (
    <div>
      <Topbar
        title="Accounts"
        actions={
          <>
            <ImportAccountsButton />
            <Link
              href="/accounts/new"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              <Plus className="h-4 w-4 mr-1" /> New
            </Link>
          </>
        }
      />
      <div className="p-4 lg:p-6">
        <div className="max-w-3xl">
          <AccountsList initialAccounts={allAccounts} />
        </div>
      </div>
    </div>
  );
}
