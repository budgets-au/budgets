"use client";

import { Check } from "lucide-react";

type Family = "default" | "terminal";

/** Two-card picker for the Appearance section on Settings → General.
 *  Writes:
 *    1. The `theme-family` cookie so the next SSR paint hits the
 *       chosen tokens with no FOUC.
 *    2. `document.documentElement.dataset.themeFamily` so the swap
 *       feels instant on the current page.
 *    3. `display_prefs.themeFamily` via the parent's `onChange`
 *       (setPref) so the choice follows the operator across
 *       devices.
 *  Mirrors the theme (light/dark) cookie pattern in
 *  `src/components/settings/theme-toggle.tsx`. */
export function ThemeFamilyPicker({
  value,
  onChange,
}: {
  value: Family;
  onChange: (next: Family) => void;
}) {
  function pick(next: Family) {
    if (next === value) return;
    document.cookie = `theme-family=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    document.documentElement.setAttribute("data-theme-family", next);
    onChange(next);
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <div>
        <p className="text-sm font-medium">Theme family</p>
        <p className="text-xs text-muted-foreground">
          Two visual identities to pick from. The dark / light toggle
          in the topbar still applies to both.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FamilyCard
          active={value === "default"}
          onClick={() => pick("default")}
          name="Default"
          copy="The original look — indigo accent, neutral greys, system fonts."
          swatches={["#6366f1", "#e5e7eb", "#111827"]}
        />
        <FamilyCard
          active={value === "terminal"}
          onClick={() => pick("terminal")}
          name="Terminal"
          copy="Precise professional tool. IBM Plex Sans + Mono. Warm amber accent on near-black."
          swatches={["#E7A24C", "#191B22", "#E7E1CE"]}
        />
      </div>
    </div>
  );
}

function FamilyCard({
  name,
  copy,
  swatches,
  active,
  onClick,
}: {
  name: string;
  copy: string;
  swatches: string[];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-lg border p-3 transition-colors flex flex-col gap-2 ${
        active
          ? "border-foreground/40 bg-muted/40 shadow-sm"
          : "border-border hover:bg-muted/30"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {swatches.map((c) => (
            <span
              key={c}
              className="inline-block h-4 w-4 rounded-sm ring-1 ring-black/5"
              style={{ backgroundColor: c }}
              aria-hidden="true"
            />
          ))}
        </div>
        <span className="text-sm font-medium">{name}</span>
        {active && (
          <Check className="h-3.5 w-3.5 ml-auto text-foreground/70" aria-hidden="true" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{copy}</p>
    </button>
  );
}
