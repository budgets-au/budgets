"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import {
  WIDGETS,
  WIDGETS_BY_ID,
  DEFAULT_DASHBOARD_LAYOUT,
} from "@/lib/dashboard/widgets";
import { newId } from "@/lib/new-id";
import { WidgetTile } from "./widget-tile";
import { WidgetDrawer } from "./widget-drawer";

/** Sentinel `i` for RGL's drop-placeholder. Picking a literal that
 * can never collide with a real placement key (registry id or UUID)
 * means the ID-set check in onLayoutChange always rejects in-flight
 * placeholder emissions, regardless of which widget is being
 * dragged — including multiInstance widgets whose drag would
 * otherwise share an `i` with an already-placed entry. */
const DROP_PLACEHOLDER_ID = "__drop-placeholder__";

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
  /** Stable per-placement key. Required for multiInstance widgets
   * (two tracked-stocks need distinct keys); optional on legacy
   * single-instance entries, where `widgetId` is unique by
   * construction and `keyOf` falls back to it. */
  instanceId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
};

function keyOf(entry: { widgetId: string; instanceId?: string }): string {
  return entry.instanceId ?? entry.widgetId;
}

type RglItem = {
  readonly i: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly minW?: number;
  readonly minH?: number;
};

/** Editable dashboard surface. Renders every widget the operator
 * placed on a 12-column responsive grid. Edit mode is toggled from
 * the topbar's actions slot (see `DashboardShell`): entering edit
 * opens a right-hand drawer with the remaining widgets, and the
 * operator drags any pill onto the grid to place it, drags placed
 * tiles to rearrange, resizes from a corner, or clicks the trash
 * icon to remove. Save commits the layout to display-prefs; Cancel
 * reverts to the most-recently-saved arrangement.
 *
 * The saved-vs-default distinction lives in display-prefs: empty
 * `dashboardLayout` means "show the registry's default arrangement"
 * so first-load matches the pre-widget dashboard verbatim. */
export function DashboardGrid({
  editMode,
  setEditMode,
}: {
  /** Controlled by the parent shell so the Edit button can live in
   * the Topbar's actions slot (which is a sibling, not a child). */
  editMode: boolean;
  setEditMode: (next: boolean) => void;
}) {
  const { prefs, setPref } = useDisplayPrefs();
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
            i: keyOf(l),
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
  // Map from RGL key → LayoutEntry so the tile renderer can resolve
  // a placement back to its widget spec + config in O(1) without
  // refiltering activeLayout each iteration.
  const layoutByKey = useMemo(
    () => new Map(activeLayout.map((l) => [keyOf(l), l] as const)),
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

  // For drawer filtering: single-instance widgets disappear once
  // placed; multiInstance widgets stay so the operator can keep
  // dropping more of the same kind (different config per placement).
  const placedWidgetIds = new Set(activeLayout.map((l) => l.widgetId));
  const availableWidgets = WIDGETS.filter(
    (w) => w.multiInstance || !placedWidgetIds.has(w.id),
  );

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
  function removeWidget(key: string) {
    setDraftLayout((cur) =>
      (cur ?? baseLayout).filter((l) => keyOf(l) !== key),
    );
  }
  function onLayoutChange(newLayout: readonly RglItem[]) {
    if (!editMode) return;
    setDraftLayout((cur) => {
      const c = cur ?? baseLayout;
      // Reject any emission whose ID-set doesn't match our state.
      // During a drag-from-drawer RGL fires onLayoutChange many
      // times per second with a drop-placeholder cell whose `i`
      // is the drawer pill's widgetId — that id isn't in our
      // draftLayout yet, so the sets differ. Each acceptance of
      // such an emission would shrink/expand the draft, flashing
      // the available-widgets list in the drawer. onDrop is the
      // only event that should commit a new placement; this
      // guards against the in-flight churn without depending on
      // React having committed `setDraggedWidgetId` before the
      // first onLayoutChange fires.
      if (newLayout.length !== c.length) return c;
      const knownKeys = new Set(c.map((l) => keyOf(l)));
      if (!newLayout.every((l) => knownKeys.has(l.i))) return c;
      // ID-sets match — this is a move/resize of existing tiles
      // (or a post-drop compaction). Diff by key, not array index,
      // since RGL's compaction can emit the same cells in a
      // different order and an index-by-index check would say
      // "different" on every emit even when geometry is identical.
      const byCurKey = new Map(c.map((l) => [keyOf(l), l] as const));
      const same = newLayout.every((l) => {
        const o = byCurKey.get(l.i)!;
        return o.x === l.x && o.y === l.y && o.w === l.w && o.h === l.h;
      });
      if (same) return c;
      return newLayout.map((l) => {
        const existing = byCurKey.get(l.i)!;
        const entry: LayoutEntry = {
          widgetId: existing.widgetId,
          x: l.x,
          y: l.y,
          w: l.w,
          h: l.h,
        };
        if (existing.instanceId) entry.instanceId = existing.instanceId;
        if (existing.config) entry.config = existing.config;
        return entry;
      });
    });
  }

  function updateWidgetConfig(
    key: string,
    config: Record<string, unknown>,
  ) {
    // Config edits write straight through to the persisted layout
    // — there's no Cancel-to-revert for a config picker the way
    // there is for x/y/w/h. The operator can just pick again to
    // revert. Match by key (instanceId for multiInstance widgets,
    // widgetId otherwise) so two tracked-stock instances can hold
    // distinct investmentIds.
    const cur = draftLayout ?? baseLayout;
    const next = cur.map((l) => (keyOf(l) === key ? { ...l, config } : l));
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
      // Single-instance widgets are guarded against double-placement
      // (the drawer hides them once placed; defence-in-depth here in
      // case of a stale drag from a previous render). Multi-instance
      // widgets always add a fresh placement with its own UUID.
      if (!widget.multiInstance && c.some((l) => l.widgetId === widgetId)) {
        return c;
      }
      const entry: LayoutEntry = {
        widgetId,
        x: item.x,
        y: item.y,
        w: widget.defaultLayout.w,
        h: widget.defaultLayout.h,
      };
      if (widget.multiInstance) entry.instanceId = newId();
      return [...c, entry];
    });
  }

  const draggedSpec = draggedWidgetId
    ? WIDGETS_BY_ID.get(draggedWidgetId)
    : null;

  // Memoise `droppingItem`. RGL's drag-over code path reads this on
  // every drag-over event (many per second) and uses it as a
  // useEffect dep further down; passing a fresh object literal each
  // render kept tripping the effect, which combined with my own
  // setDraftLayout on each drag-over was enough to exceed React's
  // depth ceiling once a child Recharts ResponsiveContainer joined
  // the cascade.
  //
  // `i` is the sentinel rather than the widgetId so the in-flight
  // placeholder can never share a key with a real placement — this
  // keeps the ID-set check in onLayoutChange honest for
  // multiInstance widgets too (dropping a second tracked-stock
  // shouldn't look "known" just because a first one exists).
  const droppingItem = useMemo(
    () =>
      draggedSpec && draggedWidgetId
        ? {
            i: DROP_PLACEHOLDER_ID,
            x: 0,
            y: 0,
            w: draggedSpec.defaultLayout.w,
            h: draggedSpec.defaultLayout.h,
          }
        : undefined,
    [draggedSpec, draggedWidgetId],
  );

  return (
    <>
      <div className="px-3 pb-3 pt-2">
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
          droppingItem={droppingItem}
          draggableCancel=".widget-cancel-drag"
        >
          {rglLayout.map((l) => {
            const entry = layoutByKey.get(l.i);
            if (!entry) return null;
            const widget = WIDGETS_BY_ID.get(entry.widgetId);
            if (!widget) return null;
            return (
              <div key={l.i}>
                <WidgetTile
                  widget={widget}
                  editMode={editMode}
                  config={entry.config}
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
