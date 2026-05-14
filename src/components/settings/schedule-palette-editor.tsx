"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { newId } from "@/lib/new-id";
import { cn } from "@/lib/utils";
import {
  FABULOUS_THEME_ID,
  STANDARD_PALETTE,
  type SchedulePalette,
} from "@/lib/chart-palettes";

/** Schedule-chart palette catalogue.
 *
 * Design rework (n-th attempt — earlier inline-editor variants got
 * eaten by click-handler / focus-management edge cases):
 *
 *   1. The list is a flat radio group of themes. Fabulous (lineage)
 *      + Standard (built-in) sit at the top, then any custom
 *      palettes. Each row shows the name and a row of four colour
 *      dots so you can pick from a glance.
 *   2. The list never edits anything. Custom rows have a pencil
 *      (open editor) and a trash (delete after confirm). Built-in
 *      rows have neither.
 *   3. Add palette + Edit both open the SAME modal dialog. The
 *      dialog owns the editing state locally; Cancel discards,
 *      Save writes back via `setPref`. Putting the edit UI in a
 *      separate dialog means no z-index / pointer-events fights
 *      with the list row's click handlers.
 */
export function SchedulePaletteEditor() {
  const { prefs, setPref } = useDisplayPrefs();
  const confirm = useConfirm();
  const custom = prefs.chartSchedulePalettes;
  const activeId = prefs.chartScheduleTheme;

  // null = closed; isNew tracks whether Save creates vs. updates.
  const [editing, setEditing] = useState<SchedulePalette | null>(null);
  const [isNew, setIsNew] = useState(false);

  function selectActive(id: string) {
    setPref("chartScheduleTheme", id);
  }

  function openAdd() {
    setIsNew(true);
    setEditing({
      ...STANDARD_PALETTE,
      id: newId(),
      name: `Custom ${custom.length + 1}`,
    });
  }

  function openEdit(p: SchedulePalette) {
    setIsNew(false);
    setEditing(p);
  }

  function commit() {
    if (!editing || !editing.name.trim()) return;
    if (isNew) {
      setPref("chartSchedulePalettes", [...custom, editing]);
    } else {
      setPref(
        "chartSchedulePalettes",
        custom.map((p) => (p.id === editing.id ? editing : p)),
      );
    }
    setEditing(null);
  }

  async function deletePalette(p: SchedulePalette) {
    const ok = await confirm({
      title: `Delete "${p.name}"?`,
      description:
        "Custom palette only — built-in Fabulous and Standard always stay.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    setPref(
      "chartSchedulePalettes",
      custom.filter((c) => c.id !== p.id),
    );
    if (activeId === p.id) {
      setPref("chartScheduleTheme", STANDARD_PALETTE.id);
    }
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="font-medium">Schedule chart theme</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick which theme the schedule view chart uses.{" "}
          <strong>Fabulous</strong> renders per-segment lineage colours
          with hatched delta fills; the others are solid four-colour
          palettes (Actual / Saved / Over / Forecast).
        </p>
      </div>

      <div className="space-y-2 p-3">
        <ThemeRow
          name="Fabulous"
          subtitle="Lineage palette + hatched fills"
          active={activeId === FABULOUS_THEME_ID}
          onSelect={() => selectActive(FABULOUS_THEME_ID)}
        />
        <ThemeRow
          name={STANDARD_PALETTE.name}
          subtitle="Built-in solid palette"
          palette={STANDARD_PALETTE}
          active={activeId === STANDARD_PALETTE.id}
          onSelect={() => selectActive(STANDARD_PALETTE.id)}
        />
        {custom.map((p) => (
          <ThemeRow
            key={p.id}
            name={p.name}
            palette={p}
            active={activeId === p.id}
            onSelect={() => selectActive(p.id)}
            onEdit={() => openEdit(p)}
            onDelete={() => deletePalette(p)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openAdd}
          className="w-full"
        >
          <Plus className="mr-1 h-4 w-4" /> Add palette
        </Button>
      </div>

      <PaletteEditDialog
        palette={editing}
        isNew={isNew}
        onChange={setEditing}
        onCommit={commit}
        onCancel={() => setEditing(null)}
      />
    </div>
  );
}

function ThemeRow({
  name,
  subtitle,
  palette,
  active,
  onSelect,
  onEdit,
  onDelete,
}: {
  name: string;
  subtitle?: string;
  palette?: SchedulePalette;
  active: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md border p-2 transition-colors",
        active ? "border-primary/60 bg-accent/50" : "hover:bg-accent/30",
      )}
    >
      <input
        type="radio"
        name="schedule-chart-theme"
        checked={active}
        onChange={onSelect}
        aria-label={`Use ${name} theme`}
        className="h-4 w-4 cursor-pointer accent-indigo-500"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{name}</p>
        {subtitle && (
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {palette && (
        <div className="flex items-center gap-1">
          <SwatchDot color={palette.actual} title="Actual" />
          <SwatchDot color={palette.saved} title="Saved" />
          <SwatchDot color={palette.over} title="Over" />
          <SwatchDot color={palette.forecast} title="Forecast" />
        </div>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${name}`}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${name}`}
          className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function SwatchDot({ color, title }: { color: string; title: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      className="block h-4 w-4 rounded-full border border-foreground/20"
      style={{ backgroundColor: color }}
    />
  );
}

function PaletteEditDialog({
  palette,
  isNew,
  onChange,
  onCommit,
  onCancel,
}: {
  palette: SchedulePalette | null;
  isNew: boolean;
  onChange: (next: SchedulePalette) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const open = palette !== null;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isNew ? "New palette" : "Edit palette"}</DialogTitle>
        </DialogHeader>
        {palette && (
          <div className="space-y-4">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Name
              </span>
              <input
                type="text"
                autoFocus
                value={palette.name}
                onChange={(e) =>
                  onChange({ ...palette, name: e.target.value })
                }
                aria-label="Palette name"
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <SwatchField
                label="Actual"
                value={palette.actual}
                onChange={(v) => onChange({ ...palette, actual: v })}
              />
              <SwatchField
                label="Saved"
                value={palette.saved}
                onChange={(v) => onChange({ ...palette, saved: v })}
              />
              <SwatchField
                label="Over"
                value={palette.over}
                onChange={(v) => onChange({ ...palette, over: v })}
              />
              <SwatchField
                label="Forecast"
                value={palette.forecast}
                onChange={(v) => onChange({ ...palette, forecast: v })}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onCommit}
            disabled={!palette?.name.trim()}
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SwatchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-background/40 p-2">
      <ColorPicker value={value} onChange={onChange} ariaLabel={label} />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}
