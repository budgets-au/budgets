import { Topbar } from "@/components/layout/topbar";
import { SettingsTabs } from "@/components/settings/settings-tabs";

export default function SettingsPage() {
  return (
    <div>
      <Topbar title="Settings" />
      <div className="p-4 lg:p-6">
        <SettingsTabs />
      </div>
    </div>
  );
}
