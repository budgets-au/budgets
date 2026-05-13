"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import {
  FABULOUS_THEME_ID,
  STANDARD_PALETTE,
  type SchedulePalette,
} from "@/lib/chart-palettes";

/** Editor for the schedule-chart palette catalogue. Built-in
 * "Standard" sits at the top read-only as a reference card; custom
 * palettes follow, each with name + four colour swatches + a
 * remove button. "Add palette" seeds a new entry with the Standard
 * colours so the operator only has to adjust what they want to
 * change. */
export function SchedulePaletteEditor() {
  const { prefs, setPref } = useDisplayPrefs();
  const custom = prefs.chartSchedulePalettes;
  const activeId = prefs.chartScheduleTheme;

  function updateCustom(next: SchedulePalette[]) {
    setPref("chartSchedulePalettes", next);
  }

  function addPalette() {
    const id = crypto.randomUUID();
    const existingCount = custom.length;
    updateCustom([
      ...custom,
      {
        ...STANDARD_PALETTE,
        id,
        name: `Custom ${existingCount + 1}`,
      },
    ]);
  }

  function deletePalette(id: string) {
    updateCustom(custom.filter((p) => p.id !== id));
    // If the deleted palette was active, fall back to the built-in
    // Standard so the chart never tries to render an unknown id.
    if (activeId === id) {
      setPref("chartScheduleTheme", STANDARD_PALETTE.id);
    }
  }

  function patchPalette(id: string, patch: Partial<SchedulePalette>) {
    updateCustom(
      custom.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  }

  return (
    <div className="rounded-xl border bg-card divide-y">
      <div className="px-4 py-3">
        <h2 className="font-medium">Schedule chart theme</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The Schedule view chart picks one theme. <strong>Fabulous</strong>{" "}
          uses per-segment lineage colours and hatched delta fills.{" "}
          <strong>Standard</strong> and any custom palette below render solid
          fills coloured by the four data types (actual spend, saved vs cap,
          over cap, forecast).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm font-medium">Active theme</p>
        <select
          value={activeId}
          onChange={(e) => setPref("chartScheduleTheme", e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          aria-label="Active schedule chart theme"
        >
          <option value={FABULOUS_THEME_ID}>Fabulous</option>
          <option value={STANDARD_PALETTE.id}>{STANDARD_PALETTE.name}</option>
          {custom.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Palettes
        </p>
        <PaletteRow palette={STANDARD_PALETTE} readOnly />
        {custom.map((p) => (
          <PaletteRow
            key={p.id}
            palette={p}
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

function PaletteRow({
  palette,
  readOnly = false,
  onChange,
  onDelete,
}: {
  palette: SchedulePalette;
  readOnly?: boolean;
  onChange?: (patch: Partial<SchedulePalette>) => void;
  onDelete?: () => void;
}) {
  // Local editable name so each keystroke doesn't round-trip
  // through SWR. Committed back to the pref on blur.
  const [name, setName] = useState(palette.name);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border bg-background/40 p-2">
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
        disabled={readOnly}
        aria-label={`Palette name for ${palette.name}`}
        className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
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
          onClick={onDelete}
          aria-label={`Delete palette ${palette.name}`}
          className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
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
    <div className="flex flex-col items-center gap-0.5">
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
