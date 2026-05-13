"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import {
  WIDGETS,
  WIDGETS_BY_ID,
  DEFAULT_DASHBOARD_LAYOUT,
} from "@/lib/dashboard/widgets";
import { WidgetTile } from "./widget-tile";
import { WidgetDrawer } from "./widget-drawer";

/** react-grid-layout reaches into the DOM on mount (WidthProvider
 * measures the parent), so dynamic-import with ssr:false avoids any
 * SSR hiccups. The 2.x v1-compat API lives under the `/legacy`
 * sub-module — same flat props the rest of the ecosystem documents. */
const ResponsiveGridLayout = dynamic(
  async () => {
    const mod = await import("react-grid-layout/legacy");
    return { default: mod.WidthProvider(mod.Responsive) };
  },
  { ssr: false },
);

type LayoutEntry = {
  widgetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
};

type RglItem = {
  readonly i: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly minW?: number;
  readonly minH?: number;
};

/** Editable dashboard surface. Renders every widget the operator has
 * placed on a 12-column responsive grid. An "Edit dashboard" button
 * top-right opens a right-hand drawer with the remaining widgets;
 * the operator drags any pill onto the grid to place it, drags
 * placed tiles to rearrange, resizes from a corner, or clicks the
 * trash icon to remove. Save commits the layout to display-prefs;
 * Cancel reverts to the most-recently-saved arrangement.
 *
 * The saved-vs-default distinction lives in display-prefs: empty
 * `dashboardLayout` means "show the registry's default arrangement"
 * so first-load matches the pre-widget dashboard verbatim. */
export function DashboardGrid() {
  const { prefs, setPref } = useDisplayPrefs();
  const [editMode, setEditMode] = useState(false);
  // Uncommitted layout while in edit mode. `null` outside edit mode
  // (the grid renders from saved prefs). Save copies this into the
  // pref blob; Cancel just drops it on the floor.
  const [draftLayout, setDraftLayout] = useState<LayoutEntry[] | null>(null);
  // Which drawer pill (if any) is currently being dragged. Tracked so
  // the grid's onDrop handler can resolve which widget to place —
  // react-grid-layout's own `item.i` defaults to a placeholder.
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);

  const baseLayout: LayoutEntry[] =
    prefs.dashboardLayout.length > 0
      ? prefs.dashboardLayout
      : DEFAULT_DASHBOARD_LAYOUT;
  const activeLayout = draftLayout ?? baseLayout;

  // Memoise the derived RGL layout + the layouts prop object so RGL
  // and its child charts (Recharts ResponsiveContainer + its own
  // ResizeObserver) don't see fresh references on every render. A
  // fresh `layouts` prop on every render was good enough to push the
  // chain over React's update-depth ceiling once a tracked-stock
  // widget (with its own ResponsiveContainer) joined the dashboard.
  const rglLayout = useMemo<RglItem[]>(
    () =>
      activeLayout
        .filter((l) => WIDGETS_BY_ID.has(l.widgetId))
        .map((l) => {
          const widget = WIDGETS_BY_ID.get(l.widgetId)!;
          return {
            i: l.widgetId,
            x: l.x,
            y: l.y,
            w: l.w,
            h: l.h,
            minW: widget.minSize?.w,
            minH: widget.minSize?.h,
          };
        }),
    [activeLayout],
  );
  const layouts = useMemo(
    () => ({
      lg: rglLayout,
      md: rglLayout,
      sm: rglLayout,
      xs: rglLayout,
      xxs: rglLayout,
    }),
    [rglLayout],
  );

  const placedIds = new Set(activeLayout.map((l) => l.widgetId));
  const availableWidgets = WIDGETS.filter((w) => !placedIds.has(w.id));

  function startEdit() {
    setDraftLayout(baseLayout);
    setEditMode(true);
  }
  function saveEdit() {
    if (draftLayout) {
      // Filter to known widgets. React-grid-layout can transiently
      // hold placeholder entries ("__dropping-elem__" during a drag,
      // or a stale entry for a widget that was renamed) that we
      // don't want to persist.
      const sanitized = draftLayout.filter((l) =>
        WIDGETS_BY_ID.has(l.widgetId),
      );
      setPref("dashboardLayout", sanitized);
    }
    setDraftLayout(null);
    setEditMode(false);
  }
  function cancelEdit() {
    setDraftLayout(null);
    setEditMode(false);
    setDraggedWidgetId(null);
  }
  function removeWidget(id: string) {
    setDraftLayout((cur) =>
      (cur ?? baseLayout).filter((l) => l.widgetId !== id),
    );
  }
  function onLayoutChange(newLayout: readonly RglItem[]) {
    if (!editMode) return;
    setDraftLayout((cur) => {
      const c = cur ?? baseLayout;
      const byId = new Map(c.map((l) => [l.widgetId, l] as const));
      const next: LayoutEntry[] = newLayout.map((l) => {
        const existing = byId.get(l.i);
        const entry: LayoutEntry = {
          widgetId: l.i,
          x: l.x,
          y: l.y,
          w: l.w,
          h: l.h,
        };
        if (existing?.config) entry.config = existing.config;
        return entry;
      });
      // Return the existing reference if nothing structurally
      // changed. Without this short-circuit, RGL re-fires
      // onLayoutChange with the same content immediately after we
      // set state — we hand back a new array, the layouts prop
      // changes by reference, RGL fires again, and React eventually
      // throws "Maximum update depth exceeded".
      const same =
        next.length === c.length &&
        next.every((n, i) => {
          const o = c[i];
          return (
            o !== undefined &&
            o.widgetId === n.widgetId &&
            o.x === n.x &&
            o.y === n.y &&
            o.w === n.w &&
            o.h === n.h
          );
        });
      return same ? c : next;
    });
  }

  function updateWidgetConfig(
    widgetId: string,
    config: Record<string, unknown>,
  ) {
    // Config edits write straight through to the persisted layout
    // — there's no Cancel-to-revert for a config picker the way
    // there is for x/y/w/h. The operator can just pick again to
    // revert.
    const cur = draftLayout ?? baseLayout;
    const next = cur.map((l) =>
      l.widgetId === widgetId ? { ...l, config } : l,
    );
    if (editMode) {
      setDraftLayout(next);
    } else {
      setPref("dashboardLayout", next);
    }
  }
  function onDrop(_layout: readonly RglItem[], item: RglItem | undefined) {
    const widgetId = draggedWidgetId;
    setDraggedWidgetId(null);
    if (!widgetId || !item) return;
    const widget = WIDGETS_BY_ID.get(widgetId);
    if (!widget) return;
    setDraftLayout((cur) => {
      const c = cur ?? baseLayout;
      if (c.some((l) => l.widgetId === widgetId)) return c;
      return [
        ...c,
        {
          widgetId,
          x: item.x,
          y: item.y,
          w: widget.defaultLayout.w,
          h: widget.defaultLayout.h,
        },
      ];
    });
  }

  const draggedSpec = draggedWidgetId
    ? WIDGETS_BY_ID.get(draggedWidgetId)
    : null;

  return (
    <>
      <div className="flex justify-end px-3 pt-2 pb-1">
        {!editMode && (
          <Button size="xs" variant="outline" onClick={startEdit}>
            <Pencil className="mr-1 h-3 w-3" /> Edit dashboard
          </Button>
        )}
      </div>
      <div className="px-3 pb-3">
        <ResponsiveGridLayout
          className="layout"
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={80}
          margin={[12, 12]}
          isDraggable={editMode}
          isResizable={editMode}
          isDroppable={editMode}
          onLayoutChange={onLayoutChange}
          onDrop={onDrop}
          droppingItem={
            draggedSpec && draggedWidgetId
              ? {
                  i: draggedWidgetId,
                  x: 0,
                  y: 0,
                  w: draggedSpec.defaultLayout.w,
                  h: draggedSpec.defaultLayout.h,
                }
              : undefined
          }
          draggableCancel=".widget-cancel-drag"
        >
          {rglLayout.map((l) => {
            const widget = WIDGETS_BY_ID.get(l.i);
            if (!widget) return null;
            const entry = activeLayout.find((e) => e.widgetId === l.i);
            return (
              <div key={l.i}>
                <WidgetTile
                  widget={widget}
                  editMode={editMode}
                  config={entry?.config}
                  onRemove={() => removeWidget(l.i)}
                  onConfigChange={(cfg) => updateWidgetConfig(l.i, cfg)}
                />
              </div>
            );
          })}
        </ResponsiveGridLayout>
      </div>
      <WidgetDrawer
        open={editMode}
        widgets={availableWidgets}
        onPickStart={setDraggedWidgetId}
        onPickEnd={() => setDraggedWidgetId(null)}
        onSave={saveEdit}
        onCancel={cancelEdit}
      />
    </>
  );
}
