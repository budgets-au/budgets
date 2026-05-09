import { Topbar } from "@/components/layout/topbar";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { asc } from "drizzle-orm";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default async function SettingsPage() {
  const allAccounts = await db.select().from(accounts).orderBy(asc(accounts.name));

  return (
    <div>
      <Topbar title="Settings" />
      <div className="p-4 lg:p-6 max-w-2xl">
        <SettingsTabs initialAccounts={allAccounts} />
      </div>
    </div>
  );
}
