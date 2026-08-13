"use client";

import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { SegmentedControl } from "@/components/ui/segmented-control";

/** Two-way toggle in the Scheduled Transactions topbar that controls
 * whether the page respects the sidebar's account filter.
 *
 *   All       — show every schedule regardless of sidebar filter
 *               (the budget-planning view of "everything I've set up").
 *   Selected  — defer to the sidebar's account selection, same as the
 *               rest of the app.
 *
 * Default is `all` because most schedules belong to the operator's
 * whole financial picture, not the slice they've narrowed the sidebar
 * to. State persists via `displayPrefs.scheduledAccountFilterMode`. */
export function ScheduledAccountFilterToggle() {
  const { prefs, setPref } = useDisplayPrefs();
  const mode = prefs.scheduledAccountFilterMode;
  return (
    <SegmentedControl
      ariaLabel="Scheduled account filter"
      value={mode}
      onChange={(v) => setPref("scheduledAccountFilterMode", v)}
      options={[
        { value: "all", label: "All accounts" },
        { value: "selected", label: "Selected accounts" },
      ]}
    />
  );
}
