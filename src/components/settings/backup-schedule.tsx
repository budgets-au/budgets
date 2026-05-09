"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface Schedule {
  enabled: boolean;
  intervalDays: number;
  retain: number;
  lastRunAt: string | null;
}

/** Inline form for the scheduled-backup config. Reads the current
 * value from /api/backup on mount, posts edits to /api/backup/schedule.
 * Changes are reflected in the scheduler within ~60s (it re-reads
 * config on every tick). */
export function BackupSchedule() {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/backup", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load schedule");
      const data: { schedule: Schedule } = await res.json();
      setSchedule(data.schedule);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(field: keyof Schedule, value: unknown) {
    if (!schedule) return;
    setSavingField(field);
    // Optimistic update so the toggle / number input feels live.
    const prev = schedule;
    setSchedule({ ...schedule, [field]: value as never });
    try {
      const res = await fetch("/api/backup/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Update failed");
      setSchedule(body.schedule);
    } catch (e) {
      setSchedule(prev);
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingField(null);
    }
  }

  if (!schedule) {
    return (
      <div className="rounded-xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-medium">Scheduled backups</h2>
        </div>
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="font-medium">Scheduled backups</h2>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label className="text-sm">Automatic backups</Label>
            <p className="text-xs text-muted-foreground">
              Take a backup on a recurring cadence in the background.
              {schedule.lastRunAt && (
                <>
                  {" "}Last run: {new Date(schedule.lastRunAt).toLocaleString()}.
                </>
              )}
            </p>
          </div>
          <Switch
            checked={schedule.enabled}
            disabled={savingField === "enabled"}
            onCheckedChange={(v) => patch("enabled", v)}
            aria-label="Enable scheduled backups"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="schedule-interval" className="text-xs">
              Interval (days)
            </Label>
            <Input
              id="schedule-interval"
              type="number"
              min="0"
              step="0.0007"
              value={schedule.intervalDays}
              disabled={savingField === "intervalDays"}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                if (Number.isFinite(n) && n > 0) patch("intervalDays", n);
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Fractional values OK — 0.0007 ≈ 1 minute (for testing).
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="schedule-retain" className="text-xs">
              Retain (count)
            </Label>
            <Input
              id="schedule-retain"
              type="number"
              min="0"
              step="1"
              value={schedule.retain}
              disabled={savingField === "retain"}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n) && n >= 0) patch("retain", n);
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Old <em>scheduled</em> backups beyond this count are
              swept after each run. Manual + pre-restore backups are
              never auto-deleted.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
