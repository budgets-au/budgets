"use client";

import { useDisplayPrefs } from "@/hooks/use-display-prefs";

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
    <div
      role="radiogroup"
      aria-label="Scheduled account filter"
      className="flex rounded-md border overflow-hidden text-xs"
    >
      {(
        [
          { value: "all", label: "All accounts" },
          { value: "selected", label: "Selected accounts" },
        ] as const
      ).map((opt) => {
        const active = mode === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPref("scheduledAccountFilterMode", opt.value)}
            className={`px-2.5 py-1 transition-colors ${
              active
                ? "bg-indigo-600 text-white font-medium"
                : "bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
