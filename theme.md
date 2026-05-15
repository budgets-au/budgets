# Theme — UI chrome colour matrix

Surface, text, border, and highlight colours used across the app's chrome
(layout, cards, buttons, inputs, navigation). Excludes data-visualisation
colours (chart palettes, sankey nodes, sparkline fills) and user-pickable
palettes (account colours, category colours, schedule-frequency colours) —
those live in their own files and are documented inline where they're
defined.

The table rows are organised **one per distinct value** with all the
tokens that resolve to it on the right, so you can see at a glance which
tokens are aliases. Sample swatches are 24×16 PNGs from
[placehold.co](https://placehold.co) so the file renders on GitHub, in
VS Code's markdown preview, and in most other markdown viewers.

Theme is driven by CSS variables in [src/app/globals.css](src/app/globals.css).
Components reference them via Tailwind utilities (`bg-background`,
`text-muted-foreground`, etc.) wired up through the `@theme inline { … }`
block at the top of that file. The light↔dark switch is a server-side
cookie read in [src/app/layout.tsx](src/app/layout.tsx) that adds
`class="dark"` to `<html>`.

---

## 1. Light theme — distinct values

| Swatch | Hex | oklch | Tokens that resolve to it | Used in |
|---|---|---|---|---|
| <img src="https://placehold.co/24x16/ffffff/cccccc.png"> | `#ffffff` | `oklch(1 0 0)` | `--background`, `--card`, `--popover` | Page background, every `<Card>`, dropdowns / popovers |
| <img src="https://placehold.co/24x16/fafafa/cccccc.png"> | `#fafafa` | `oklch(0.985 0 0)` | `--sidebar`, `--primary-foreground`, `--sidebar-primary-foreground` | A slight off-white for the sidebar surface; text on primary buttons |
| <img src="https://placehold.co/24x16/f5f5f5/cccccc.png"> | `#f5f5f5` | `oklch(0.97 0 0)` | `--secondary`, `--muted`, `--accent`, `--sidebar-accent` | Hover backgrounds on nav rows + list rows, inert chips, secondary buttons |
| <img src="https://placehold.co/24x16/ebebeb/cccccc.png"> | `#ebebeb` | `oklch(0.922 0 0)` | `--border`, `--input`, `--sidebar-border` | Card edges, input outlines, list-row dividers |
| <img src="https://placehold.co/24x16/b5b5b5/b5b5b5.png"> | `#b5b5b5` | `oklch(0.708 0 0)` | `--ring`, `--sidebar-ring` | Keyboard-focus ring |
| <img src="https://placehold.co/24x16/888888/888888.png"> | `#888888` | `oklch(0.556 0 0)` | `--muted-foreground` | Captions, helper text, placeholders, "x of y" counts |
| <img src="https://placehold.co/24x16/353535/353535.png"> | `#353535` | `oklch(0.205 0 0)` | `--primary`, `--secondary-foreground`, `--accent-foreground`, `--sidebar-primary`, `--sidebar-accent-foreground` | Primary button background (deliberately neutral, *not* the brand accent); text on `bg-secondary` / `bg-accent` |
| <img src="https://placehold.co/24x16/252525/252525.png"> | `#252525` | `oklch(0.145 0 0)` | `--foreground`, `--card-foreground`, `--popover-foreground`, `--sidebar-foreground` | Body text |
| <img src="https://placehold.co/24x16/dc2626/dc2626.png"> | `≈ #dc2626` (red-600) | `oklch(0.577 0.245 27.325)` | `--destructive` | Destructive-action titles + bordered "delete" buttons |

---

## 2. Dark theme — distinct values

| Swatch | Hex | oklch | Tokens that resolve to it | Used in |
|---|---|---|---|---|
| <img src="https://placehold.co/24x16/252525/252525.png"> | `#252525` | `oklch(0.145 0 0)` | `--background` | Page background |
| <img src="https://placehold.co/24x16/353535/353535.png"> | `#353535` | `oklch(0.205 0 0)` | `--card`, `--popover`, `--sidebar`, `--primary-foreground` | Every card + popover (lifted one level above the page background); text on primary buttons |
| <img src="https://placehold.co/24x16/424242/424242.png"> | `#424242` | `oklch(0.269 0 0)` | `--secondary`, `--muted`, `--accent`, `--sidebar-accent` | Hover backgrounds, inert chips, secondary buttons |
| <img src="https://placehold.co/24x16/ffffff19/ffffff19.png"> | `rgba(255,255,255,.10)` | `oklch(1 0 0 / 10%)` | `--border`, `--sidebar-border` | Translucent hairlines |
| <img src="https://placehold.co/24x16/ffffff26/ffffff26.png"> | `rgba(255,255,255,.15)` | `oklch(1 0 0 / 15%)` | `--input` | Form-input outline (slightly brighter than `--border` so it reads as an interactive affordance) |
| <img src="https://placehold.co/24x16/888888/888888.png"> | `#888888` | `oklch(0.556 0 0)` | `--ring`, `--sidebar-ring` | Keyboard-focus ring |
| <img src="https://placehold.co/24x16/b5b5b5/b5b5b5.png"> | `#b5b5b5` | `oklch(0.708 0 0)` | `--muted-foreground` | Captions, helper text |
| <img src="https://placehold.co/24x16/ebebeb/cccccc.png"> | `#ebebeb` | `oklch(0.922 0 0)` | `--primary` | Inverted: primary button is now near-white |
| <img src="https://placehold.co/24x16/fafafa/cccccc.png"> | `#fafafa` | `oklch(0.985 0 0)` | `--foreground`, `--card-foreground`, `--popover-foreground`, `--sidebar-foreground`, `--secondary-foreground`, `--accent-foreground`, `--sidebar-accent-foreground` | Body text, text on `bg-card` / `bg-secondary` / `bg-accent` (everything that was `#252525` *or* `#353535` in light) |
| <img src="https://placehold.co/24x16/ef4444/ef4444.png"> | `≈ #ef4444` (red-500) | `oklch(0.704 0.191 22.216)` | `--destructive` | Brighter than light's destructive so it stays legible on dark cards |
| <img src="https://placehold.co/24x16/6366f1/6366f1.png"> | `≈ indigo-500` | `oklch(0.488 0.243 264.376)` | `--sidebar-primary` | The only chromatic dark-mode token — reserved for the (currently unmounted) shadcn sidebar primitive |

---

## 3. Brand highlight — indigo

The app's de-facto accent colour. Reach for these hexes (or the matching
Tailwind `indigo-*` utilities) wherever you want a **coloured**
affordance — selected pill, active range preset, link colour. `--primary`
is near-black on purpose; it's not what you want for a "highlighted" CTA.

| Swatch | Hex | Tailwind | Used in |
|---|---|---|---|
| <img src="https://placehold.co/24x16/eef2ff/eef2ff.png"> | `#eef2ff` | indigo-50 | Subtle tinted backgrounds: selected-row hover, badge fills |
| <img src="https://placehold.co/24x16/c7d2fe/c7d2fe.png"> | `#c7d2fe` | indigo-200 | Light-mode chip text, dark-mode chip background |
| <img src="https://placehold.co/24x16/818cf8/818cf8.png"> | `#818cf8` | indigo-400 | Outline borders on indigo-tinted callouts (`border-indigo-400`) |
| <img src="https://placehold.co/24x16/6366f1/6366f1.png"> | `#6366f1` | indigo-500 | Default highlight: focus ring, selected tab underline, "active" affordance backgrounds at `bg-indigo-500/{10..45}` |
| <img src="https://placehold.co/24x16/4f46e5/4f46e5.png"> | `#4f46e5` | indigo-600 | Active range-preset button ([reports-view.tsx:512](src/components/reports/reports-view.tsx#L512)), pressed indigo CTAs |
| <img src="https://placehold.co/24x16/4338ca/4338ca.png"> | `#4338ca` | indigo-700 | Hover state on `bg-indigo-600` |

---

## 4. Status text

Inline text colours that carry meaning. These show up in totals, balances,
delta labels, badges — *not* in chart fills (those are documented in the
chart components themselves).

| Swatch | Hex | Tailwind | Tokens / constants | Used in |
|---|---|---|---|---|
| <img src="https://placehold.co/24x16/059669/059669.png"> | `#059669` | emerald-600 | — | Income totals, balance going up, positive day delta, "received" tags (`text-emerald-600`) |
| <img src="https://placehold.co/24x16/047857/047857.png"> | `#047857` | emerald-700 | — | Hover state on emerald-600 links |
| <img src="https://placehold.co/24x16/34d399/34d399.png"> | `#34d399` | emerald-400 | — | Dark-mode equivalent of emerald-600 |
| <img src="https://placehold.co/24x16/ef4444/ef4444.png"> | `#ef4444` | red-500 | `TREND_DOWN` ([colours.ts](src/lib/colours.ts)), `--destructive` (dark) | Expense totals, balance going down, sparkline-down strokes, error toast text |
| <img src="https://placehold.co/24x16/dc2626/dc2626.png"> | `#dc2626` | red-600 | `--destructive` (light) | Hover on red-500 links, destructive button text |
| <img src="https://placehold.co/24x16/f87171/f87171.png"> | `#f87171` | red-400 | — | Dark-mode equivalent of red-500 |
| <img src="https://placehold.co/24x16/f59e0b/f59e0b.png"> | `#f59e0b` | amber-500 | — | "Near limit" budget pills, missed-schedule banner border, pending-action callouts |
| <img src="https://placehold.co/24x16/b45309/b45309.png"> | `#b45309` | amber-700 | — | Hover state on warning links |
| <img src="https://placehold.co/24x16/fbbf24/fbbf24.png"> | `#fbbf24` | amber-400 | — | Dark-mode warning text |

---

## 5. Scrollbar

Slim semi-transparent slider that brightens on hover. Defined in
[src/app/globals.css:145-178](src/app/globals.css#L145-L178); not exposed
as a theme token.

| Swatch (light) | Swatch (dark) | Source | Used in |
|---|---|---|---|
| <img src="https://placehold.co/24x16/b3b3b3/b3b3b3.png"> | <img src="https://placehold.co/24x16/999999/999999.png"> | `oklch(0.7 0 0 / 0.35)` / `oklch(0.6 0 0 / 0.4)` | Scrollbar thumb (resting) |
| <img src="https://placehold.co/24x16/8c8c8c/8c8c8c.png"> | <img src="https://placehold.co/24x16/bfbfbf/bfbfbf.png"> | `oklch(0.55 0 0 / 0.55)` / `oklch(0.75 0 0 / 0.6)` | Scrollbar thumb (hover) |

---

## Adding a new colour

If a hex value lands in chrome code without a clear home, prefer one of
these before introducing a new constant:

1. **Need light/dark parity** for a surface, text, or border? Add a token
   to `globals.css`'s `:root` and `.dark` blocks and reference it via a
   Tailwind utility wired up in the `@theme inline { … }` block.
2. **Highlighted action / link / selected state**? Reach for indigo —
   `#6366f1` / `#4f46e5` / Tailwind `indigo-500..700` — `--primary` is
   intentionally near-black.
3. **Status copy** (positive / negative / warning)? Use the emerald / red
   / amber values in section 4. For chart fills that mean "going up" or
   "going down" use the `TREND_UP` / `TREND_DOWN` constants from
   [src/lib/colours.ts](src/lib/colours.ts).
4. **Focus / hover affordance**? Don't add a new ring colour; use
   `ring-ring` or the indigo accent.

When in doubt, grep this file for what already exists. Chart fills,
sankey/calendar dots, account/category/schedule pickers are documented
inside their own modules — they're not theme chrome and shouldn't share
this matrix.
