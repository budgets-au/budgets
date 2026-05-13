"use client";

import { Trash2 } from "lucide-react";
import type { WidgetSpec } from "@/lib/dashboard/widgets";

/** Renders a single dashboard widget. In edit mode it overlays a
 * dashed outline + a trash icon for removal. The overlay sits above
 * the card so the user gets a clear "this is editable" affordance,
 * but is pointer-events-none on the body so the underlying drag from
 * react-grid-layout still picks up clicks anywhere on the tile.
 *
 * The remove button uses `widget-cancel-drag` so the grid's
 * `draggableCancel` ignores its clicks (without it, clicking the
 * trash would also start a drag). */
export function WidgetTile({
  widget,
  editMode,
  onRemove,
}: {
  widget: WidgetSpec;
  editMode: boolean;
  onRemove: () => void;
}) {
  return (
    <div className="relative h-full w-full">
      {widget.render()}
      {editMode && (
        <div className="absolute inset-0 z-10 rounded-md border-2 border-dashed border-primary/50 bg-background/10 pointer-events-none">
          <button
            type="button"
            aria-label={`Remove ${widget.title}`}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="widget-cancel-drag pointer-events-auto absolute top-2 right-2 rounded bg-background/90 p-1 text-foreground shadow-sm hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
