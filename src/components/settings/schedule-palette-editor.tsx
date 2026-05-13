"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { cn } from "@/lib/utils";
import {
  FABULOUS_THEME_ID,
  STANDARD_PALETTE,
  type SchedulePalette,
} from "@/lib/chart-palettes";

/** Schedule-chart palette catalogue. Each entry is a row containing
 * a radio for "active theme", a name (editable on custom rows), four
 * colour swatches (editable on custom rows), and a remove button on
 * custom rows. Fabulous sits at the top with no colour swatches —
 * the chart renders it with its own lineage palette + hatched fills.
 * "Add palette" seeds a new row with the Standard colours so the
 * operator only has to adjust the slots they want to change. */
export function SchedulePaletteEditor() {
  const { prefs, setPref } = useDisplayPrefs();
  const custom = prefs.chartSchedulePalettes;
  const activeId = prefs.chartScheduleTheme;

  function selectActive(id: string) {
    setPref("chartScheduleTheme", id);
  }

  function addPalette() {
    const id = crypto.randomUUID();
    setPref("chartSchedulePalettes", [
      ...custom,
      {
        ...STANDARD_PALETTE,
        id,
        name: `Custom ${custom.length + 1}`,
      },
    ]);
  }

  function deletePalette(id: string) {
    setPref(
      "chartSchedulePalettes",
      custom.filter((p) => p.id !== id),
    );
    if (activeId === id) {
      setPref("chartScheduleTheme", STANDARD_PALETTE.id);
    }
  }

  function patchPalette(id: string, patch: Partial<SchedulePalette>) {
    setPref(
      "chartSchedulePalettes",
      custom.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="font-medium">Schedule chart theme</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick which theme the schedule view chart uses.{" "}
          <strong>Fabulous</strong> uses per-segment lineage colours +
          hatched delta fills. <strong>Standard</strong> and any custom
          palette render solid fills using the four data-type colours
          (actual / saved / over / forecast).
        </p>
      </div>

      <div className="space-y-2 p-3">
        <ThemeRow
          id={FABULOUS_THEME_ID}
          name="Fabulous"
          active={activeId === FABULOUS_THEME_ID}
          onSelect={() => selectActive(FABULOUS_THEME_ID)}
          isFabulous
        />
        <PaletteRow
          palette={STANDARD_PALETTE}
          active={activeId === STANDARD_PALETTE.id}
          onSelect={() => selectActive(STANDARD_PALETTE.id)}
          readOnly
        />
        {custom.map((p) => (
          <PaletteRow
            key={p.id}
            palette={p}
            active={activeId === p.id}
            onSelect={() => selectActive(p.id)}
            onChange={(patch) => patchPalette(p.id, patch)}
            onDelete={() => deletePalette(p.id)}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={addPalette}
          className="w-full"
        >
          <Plus className="mr-1 h-4 w-4" /> Add palette
        </Button>
      </div>
    </div>
  );
}

function ThemeRow({
  id,
  name,
  active,
  onSelect,
  isFabulous,
}: {
  id: string;
  name: string;
  active: boolean;
  onSelect: () => void;
  isFabulous?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-md border p-2 transition-colors",
        active ? "border-primary/60 bg-accent/50" : "hover:bg-accent/30",
      )}
    >
      <input
        type="radio"
        name="schedule-chart-theme"
        checked={active}
        onChange={onSelect}
        value={id}
        className="h-4 w-4 cursor-pointer accent-indigo-500"
      />
      <span className="flex-1 text-sm font-medium">{name}</span>
      {isFabulous && (
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          lineage palette
        </span>
      )}
    </label>
  );
}

function PaletteRow({
  palette,
  active,
  onSelect,
  readOnly = false,
  onChange,
  onDelete,
}: {
  palette: SchedulePalette;
  active: boolean;
  onSelect: () => void;
  readOnly?: boolean;
  onChange?: (patch: Partial<SchedulePalette>) => void;
  onDelete?: () => void;
}) {
  // Local editable name so each keystroke doesn't round-trip through
  // SWR. Committed back to the pref on blur.
  const [name, setName] = useState(palette.name);

  return (
    <label
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-md border p-2 transition-colors",
        active ? "border-primary/60 bg-accent/50" : "hover:bg-accent/30",
      )}
    >
      <input
        type="radio"
        name="schedule-chart-theme"
        checked={active}
        onChange={onSelect}
        value={palette.id}
        className="h-4 w-4 cursor-pointer accent-indigo-500"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          if (onChange && name.trim() && name !== palette.name) {
            onChange({ name: name.trim() });
          } else if (!name.trim()) {
            setName(palette.name);
          }
        }}
        onClick={(e) => e.preventDefault()}
        disabled={readOnly}
        aria-label={`Palette name for ${palette.name}`}
        className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:opacity-100"
      />
      <PaletteSwatch
        label="Actual"
        value={palette.actual}
        readOnly={readOnly}
        onChange={(v) => onChange?.({ actual: v })}
      />
      <PaletteSwatch
        label="Saved"
        value={palette.saved}
        readOnly={readOnly}
        onChange={(v) => onChange?.({ saved: v })}
      />
      <PaletteSwatch
        label="Over"
        value={palette.over}
        readOnly={readOnly}
        onChange={(v) => onChange?.({ over: v })}
      />
      <PaletteSwatch
        label="Forecast"
        value={palette.forecast}
        readOnly={readOnly}
        onChange={(v) => onChange?.({ forecast: v })}
      />
      {onDelete && !readOnly && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
          aria-label={`Delete palette ${palette.name}`}
          className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </label>
  );
}

function PaletteSwatch({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-0.5"
      onClick={(e) => e.preventDefault()}
    >
      <ColorPicker
        value={value}
        onChange={onChange}
        ariaLabel={`${label} colour`}
        disabled={readOnly}
      />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
    </div>
  );
}
