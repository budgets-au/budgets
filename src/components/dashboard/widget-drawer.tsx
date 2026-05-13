"use client";

import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WidgetSpec } from "@/lib/dashboard/widgets";

/** Edit-mode side panel listing every widget not currently on the
 * grid. Each pill is HTML5-draggable; the grid receives the drop via
 * react-grid-layout's `isDroppable` mechanism. The drawer is just a
 * fixed-position panel so it can sit next to a non-modal grid (Sheet
 * primitive would steal focus and dim the page). */
export function WidgetDrawer({
  open,
  widgets,
  onPickStart,
  onPickEnd,
  onSave,
  onCancel,
}: {
  open: boolean;
  widgets: WidgetSpec[];
  onPickStart: (id: string) => void;
  onPickEnd: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      aria-hidden={!open}
      className={cn(
        // Sits in the same left-edge slot as the navigation sidebar
        // (`<Sidebar>` is z-50, w-60 = 240px). Putting the drawer
        // there means it covers the navigator while editing instead
        // of overlapping the dashboard grid itself; closing the
        // drawer reveals the navigator again. z-60 keeps it above
        // the sidebar so the navigator never bleeds through.
        "fixed top-0 left-0 z-60 flex h-full w-60 flex-col border-r bg-popover text-popover-foreground shadow-lg transition-transform duration-200 ease-in-out",
        open ? "translate-x-0" : "pointer-events-none -translate-x-full",
      )}
    >
      <div className="border-b p-4">
        <h2 className="font-heading text-base font-medium">Edit dashboard</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Drag tiles to rearrange, resize from a corner, or drop one of
          these onto the grid to add it.
        </p>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Available
        </p>
        {widgets.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            All widgets placed.
          </p>
        ) : (
          widgets.map((w) => (
            <div
              key={w.id}
              draggable
              unselectable="on"
              onDragStart={(e) => {
                // react-grid-layout reads dataTransfer to detect an
                // external drag; the actual id is tracked in parent
                // state for the onDrop handler.
                e.dataTransfer.setData("text/plain", w.id);
                e.dataTransfer.effectAllowed = "move";
                onPickStart(w.id);
              }}
              onDragEnd={onPickEnd}
              className="droppable-element flex cursor-grab items-center gap-2 rounded-md border bg-card p-2 text-sm hover:bg-accent active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{w.title}</span>
            </div>
          ))
        )}
      </div>
      <div className="flex justify-end gap-2 border-t p-4">
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave}>
          Save layout
        </Button>
      </div>
    </div>
  );
}
