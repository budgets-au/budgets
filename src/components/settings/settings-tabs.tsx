"use client";

import Link from "next/link";
import { KeyRound, Lock, Loader2 } from "lucide-react";
import type { Account } from "@/db/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useLockDatabase } from "@/hooks/use-lock-database";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { ThemeToggle } from "@/components/settings/theme-toggle";
import { AccountVisibility } from "@/components/settings/account-visibility";
import { PayeeRulesManager } from "@/components/settings/payee-rules-manager";
import { BackupList } from "@/components/settings/backup-list";
import { BackupSchedule } from "@/components/settings/backup-schedule";
import { UserManager } from "@/components/settings/user-manager";
import { SampleDataPanel } from "@/components/settings/sample-data-panel";

export function SettingsTabs({ initialAccounts }: { initialAccounts: Account[] }) {
  const { lock: lockNow, locking } = useLockDatabase();
  const { prefs, setPref } = useDisplayPrefs();

  return (
    <Tabs defaultValue="general">
      <TabsList variant="line">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="rules">Rules</TabsTrigger>
        <TabsTrigger value="backups">Backups</TabsTrigger>
        <TabsTrigger value="security">Security</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="space-y-6">
        <ThemeToggle />
        <div className="rounded-xl border bg-card divide-y">
          <div className="px-4 py-3">
            <h2 className="font-medium">Display</h2>
          </div>
          <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
            <div className="min-w-0">
              <p className="text-sm font-medium">Weekly column on scheduled list</p>
              <p className="text-xs text-muted-foreground">
                Shows a per-row weekly equivalent + a footer total. Turn off
                if the row is too crowded on narrower screens.
              </p>
            </div>
            <Switch
              checked={prefs.scheduledShowWeekly}
              onCheckedChange={(v) => setPref("scheduledShowWeekly", v)}
              aria-label="Toggle Weekly column on scheduled list"
            />
          </label>
          <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
            <div className="min-w-0">
              <p className="text-sm font-medium">Linked transactions panel</p>
              <p className="text-xs text-muted-foreground">
                The right-side counterpart pane on the transactions list
                (direction arrow, paired account, paired payee + amount).
                Turn off if you mostly review single-account flows and
                want a narrower table.
              </p>
            </div>
            <Switch
              checked={prefs.transactionsShowLinkedPanel}
              onCheckedChange={(v) =>
                setPref("transactionsShowLinkedPanel", v)
              }
              aria-label="Toggle linked transactions panel"
            />
          </label>
          <label className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer">
            <div className="min-w-0">
              <p className="text-sm font-medium">Linked details inside panel</p>
              <p className="text-xs text-muted-foreground">
                When the linked panel is on, also show the paired payee and
                paired amount cells. Off keeps the panel narrow — just the
                direction arrow and account chip.
              </p>
            </div>
            <Switch
              checked={prefs.transactionsShowLinkedDetails}
              onCheckedChange={(v) =>
                setPref("transactionsShowLinkedDetails", v)
              }
              aria-label="Toggle linked-transaction detail cells"
            />
          </label>
        </div>
        <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">About</p>
          <p>Household Budget Tracker · AUD · Local / Docker</p>
        </div>
      </TabsContent>

      <TabsContent value="accounts">
        <AccountVisibility initialAccounts={initialAccounts} />
      </TabsContent>

      <TabsContent value="rules">
        <PayeeRulesManager />
      </TabsContent>

      <TabsContent value="backups" className="space-y-6">
        <BackupList />
        <BackupSchedule />
      </TabsContent>

      <TabsContent value="security" className="space-y-6">
        <UserManager />
        <SampleDataPanel />
        <div className="rounded-xl border bg-card divide-y">
          <div className="px-4 py-3">
            <h2 className="font-medium">Database passphrase</h2>
          </div>
          <Link
            href="/rekey"
            className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
          >
            <KeyRound className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Change database passphrase</p>
              <p className="text-xs text-muted-foreground">
                Rotate the SQLCipher key. The file is re-encrypted in place;
                future cold starts will require the new passphrase. Existing
                sessions stay open.
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={lockNow}
            disabled={locking}
            className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {locking ? (
              <Loader2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0 animate-spin" />
            ) : (
              <Lock className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium">Lock database now</p>
              <p className="text-xs text-muted-foreground">
                Drops the in-memory passphrase. Every device using this server
                will be bounced to /unlock until someone re-enters it.
              </p>
            </div>
          </button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
