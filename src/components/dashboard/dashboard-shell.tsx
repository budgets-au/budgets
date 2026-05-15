"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Topbar } from "@/components/layout/topbar";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";

/** Page-level shell that owns the dashboard's edit-mode state.
 * Pulls the "Edit dashboard" button into the Topbar's actions slot
 * (immediately left of the profile dropdown) rather than floating
 * it above the grid — same chrome rhythm as the other top-level
 * pages, and frees up vertical room above the first row of
 * widgets.
 *
 * `editMode` is hoisted out of `DashboardGrid` so the button can
 * live in a sibling component (Topbar). Save / Cancel still live
 * inside the widget drawer the grid manages — they call
 * `setEditMode(false)` via the prop. */
export function DashboardShell() {
  const [editMode, setEditMode] = useState(false);
  return (
    <>
      <Topbar
        title="Dashboard"
        actions={
          !editMode ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditMode(true)}
            >
              <Pencil className="mr-1 h-3 w-3" /> Edit dashboard
            </Button>
          ) : null
        }
      />
      <DashboardGrid editMode={editMode} setEditMode={setEditMode} />
    </>
  );
}
