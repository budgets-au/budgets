"use client";

import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSwrJson } from "@/hooks/use-swr-json";
import { useToggleSet } from "@/hooks/use-toggle-set";
import Link from "next/link";
import { format, parseISO, endOfMonth } from "date-fns";
import { ChevronDown, ChevronRight, Eye, EyeOff, Plus, Tag } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useDisplayPrefs } from "@/hooks/use-display-prefs";
import { numFmt } from "@/lib/utils";
import type { CashflowReport as CashflowData, CashflowCategory } from "@/app/api/reports/cashflow/route";
import { CashflowCellDialog, type CashflowCellQuery } from "./cashflow-cell-dialog";
import { buildVirtualRowsByTag } from "@/lib/reports/virtual-rows";
import { buildCategoryPathStringMap } from "@/lib/category-path";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

const CellOpenerContext = createContext<((q: CashflowCellQuery) => void) | null>(null);
const useCellOpener = () => useContext(CellOpenerContext);

/** Column-options context. Avoids threading `opts: ColOpts`
 *  through every row component and JSX call-site. The interface
 *  itself is declared further down with the rest of the
 *  rendering types — TS hoists interfaces so a forward reference
 *  is fine here. */
const ColOptsContext = createContext<ColOpts | null>(null);
function useColOpts(): ColOpts {
  const v = useContext(ColOptsContext);
  if (v === null) {
    throw new Error(
      "useColOpts must be called inside a ColOptsContext.Provider",
    );
  }
  return v;
}

/** Per-row "hide" toggle. Each LeafRow / SubParentHeaderRow /
 * GrandparentHeaderRow looks this up to render its eye icon. The
 * `isHidden` predicate is shared so a parent's exclusion cascades
 * to its descendants without each row hauling around the full set. */
const HideToggleContext = createContext<{
  isHidden: (id: string) => boolean;
  toggle: (id: string) => void;
} | null>(null);
const useHideToggle = () => useContext(HideToggleContext);

/** Context for editing a category's tags from within any row of
 *  the Cashflow report — the `+` button next to HideEye opens
 *  CategoryTagsPopover which reads and writes through this. Kept
 *  narrow (three fields) so the report component stays the single
 *  writer to `/api/categories` from within this surface. */
const TagContext = createContext<{
  tagsFor: (catId: string) => string[];
  allTags: string[];
  /** Persists the tags. Returns `true` on success, `false` on any
   *  failure (network / 4xx / 5xx). Callers use the boolean to
   *  decide whether to close their editor — a `false` here means a
   *  toast has already fired and the draft should stay visible. */
  saveTags: (catId: string, next: string[]) => Promise<boolean>;
} | null>(null);
const useTagCtx = () => useContext(TagContext);

/** Popover-backed chips editor for a category's tags. Rendered as
 *  the small `+` button next to HideEye on every LeafRow. Mirrors
 *  the chip pattern in the /categories admin dialog so the two
 *  surfaces behave identically. */
function CategoryTagsPopover({
  catId,
  catName,
}: {
  catId: string;
  catName: string;
}) {
  const ctx = useTagCtx();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [input, setInput] = useState("");
  // Snapshot the cat's current tags on the open false→true
  // transition only. Firing this effect on every `ctx` change
  // (as the previous version did) meant any SWR revalidation
  // mid-typing — window focus, another popover saving, a display-
  // pref mutation — would blow away the user's draft and input.
  // The ref-based transition guard keeps the popover's local state
  // stable while it's open. Explicitly OMIT `ctx` from the dep list
  // for that reason (see the ESLint disable below).
  const prevOpen = useRef(false);
  useEffect(() => {
    if (open && !prevOpen.current && ctx) {
      setDraft(ctx.tagsFor(catId));
      setInput("");
    }
    prevOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, catId]);
  if (!ctx) return null;

  function addTag(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (draft.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    setDraft((prev) => [...prev, t]);
    setInput("");
  }
  function removeTag(t: string) {
    setDraft((prev) => prev.filter((x) => x !== t));
  }
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(input);
    } else if (e.key === "Backspace" && input === "" && draft.length > 0) {
      e.preventDefault();
      setDraft((prev) => prev.slice(0, -1));
    }
  }
  async function save() {
    if (!ctx) return;
    const finalTags = input.trim()
      ? draft.some((x) => x.toLowerCase() === input.trim().toLowerCase())
        ? draft
        : [...draft, input.trim()]
      : draft;
    setSaving(true);
    try {
      // Close the popover ONLY if saveTags reports success. On any
      // 4xx / 5xx / network failure we keep the popover open so the
      // user can see the toast and their draft — closing would
      // silently discard the edit.
      const ok = await ctx.saveTags(catId, finalTags);
      if (ok) setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="p-0.5 rounded hover:bg-muted transition-opacity print:hidden opacity-0 group-hover:opacity-60 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-60"
            title="Edit tags"
            aria-label={`Edit tags for ${catName}`}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Plus className="h-3 w-3" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Tags — {catName}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-0">
          {draft.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
            >
              #{t}
              <button
                type="button"
                onClick={() => removeTag(t)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove tag ${t}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            list={`cat-tags-suggestions-${catId}`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={draft.length === 0 ? "Add a tag…" : ""}
            className="flex-1 min-w-24 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <datalist id={`cat-tags-suggestions-${catId}`}>
            {ctx.allTags
              .filter(
                (t) => !draft.some((x) => x.toLowerCase() === t.toLowerCase()),
              )
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Enter or comma to add. Each tag becomes a virtual row below the main table.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={saving}
            className="text-xs px-3 py-1 rounded border hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="text-xs px-3 py-1 rounded bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Small always-visible indicator rendered inside a category row's
 *  label cell when the cat carries ≥1 tag. Hovering the icon
 *  reveals the tag list via the native `title` tooltip so the
 *  operator can see at a glance which cats are tagged and how,
 *  without opening the popover to check. Renders nothing for
 *  untagged cats. */
function TagIndicator({ catId }: { catId: string }) {
  const ctx = useTagCtx();
  if (!ctx) return null;
  const tags = ctx.tagsFor(catId);
  if (tags.length === 0) return null;
  const title = tags.map((t) => `#${t}`).join(", ");
  return (
    <span
      className="inline-flex items-center text-muted-foreground/60 shrink-0 print:hidden"
      title={title}
      aria-label={`Tags: ${title}`}
    >
      <Tag className="h-3 w-3" />
    </span>
  );
}

function HideEye({ catId, isHidden }: { catId: string; isHidden: boolean }) {
  const ctx = useHideToggle();
  if (!ctx) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        ctx.toggle(catId);
      }}
      className={`ml-auto p-0.5 rounded hover:bg-muted transition-opacity print:hidden ${
        isHidden
          ? "opacity-70 hover:opacity-100"
          : "opacity-0 group-hover:opacity-60 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-60"
      }`}
      title={isHidden ? "Show this category" : "Hide this category"}
      aria-label={isHidden ? "Show category" : "Hide category"}
    >
      {isHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
    </button>
  );
}

function monthRange(m: string): { from: string; to: string; label: string } {
  const start = `${m}-01`;
  const startDate = parseISO(start);
  return {
    from: start,
    to: format(endOfMonth(startDate), "yyyy-MM-dd"),
    label: format(startDate, "MMM ''yy"),
  };
}

function totalRangeLabel(from: string, to: string): string {
  const a = format(parseISO(from), "MMM ''yy");
  const b = format(parseISO(to), "MMM ''yy");
  return a === b ? a : `${a} – ${b}`;
}


type CellResult = { text: string; className: string };

function formatAmount(n: number | undefined, mode: "plain" | "net" | "balance" = "plain"): CellResult {
  if (n === undefined || n === 0) return { text: "—", className: "text-muted-foreground" };
  if (n < 0) return { text: `(${numFmt.format(Math.abs(n))})`, className: mode === "plain" ? "text-foreground" : "text-red-500" };
  return { text: numFmt.format(n), className: mode === "net" ? "text-emerald-600" : "text-foreground" };
}

function AmountCell({
  value,
  colHighlight,
  mode = "plain",
  negate,
  muted,
  borderLeft,
  computed,
  compact,
  onClick,
  trailing,
}: {
  value: number | undefined;
  colHighlight?: boolean;
  mode?: "plain" | "net" | "balance";
  negate?: boolean;
  muted?: boolean;
  /** Adds a left border so adjacent month groups read as visually distinct. */
  borderLeft?: boolean;
  /** Flags this as a calculated column (Total / Avg / Plan-mo) — adds
   * a left separator and a subtle background tint so the operator
   * sees at a glance which figures are aggregates and which are raw
   * monthly data. */
  computed?: boolean;
  /** Slightly smaller font — used on the Plan / Diff body cells so
   *  the derived sub-columns read as quieter than the primary
   *  actual amount. */
  compact?: boolean;
  /** When set and the value is non-zero, the rendered amount becomes a
   * button that opens the cell-drilldown dialog. */
  onClick?: () => void;
  /** Optional indicator rendered after the number (e.g. a Σ marker
   *  on rolled-up parent rows). */
  trailing?: React.ReactNode;
}) {
  const display = negate && value !== undefined ? -value : value;
  const { text, className } = formatAmount(display, mode);
  const colour = muted ? "text-muted-foreground" : className;
  const isClickable = onClick && value !== undefined && value !== 0;
  const content = isClickable ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="hover:underline hover:text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded -mx-0.5 px-0.5 transition-colors"
    >
      {text}
    </button>
  ) : (
    text
  );
  return (
    <td
      className={`pl-3 pr-1.5 py-1.5 text-right tabular-nums ${compact ? "text-[11px]" : ""} ${
        colHighlight
          ? "bg-indigo-500/10 print:bg-transparent"
          : computed
            ? "bg-muted/40"
            : ""
      } ${borderLeft || computed ? "border-l border-border" : ""} ${colour}`}
    >
      {trailing ? (
        <span className="inline-flex items-center gap-0.5 align-baseline">
          {content}
          {trailing}
        </span>
      ) : (
        content
      )}
    </td>
  );
}

/** Compact secondary cell rendered next to a month's actual when the
 * Plan toggle is enabled. Muted styling so the actual stays the dominant
 * value at a glance. */
function MonthSubCell({
  value,
  colHighlight,
  borderLeft,
}: {
  value: number | undefined;
  colHighlight?: boolean;
  borderLeft?: boolean;
}) {
  const { text } = formatAmount(value && value > 0 ? value : undefined, "plain");
  return (
    <td
      className={`px-2 py-1.5 text-right tabular-nums text-[11px] text-muted-foreground/70 whitespace-nowrap ${
        colHighlight ? "bg-indigo-500/10 print:bg-transparent" : ""
      } ${borderLeft ? "border-l border-border" : ""}`}
    >
      {text}
    </td>
  );
}

/** Sum of budget + scheduled for a month, returning undefined when neither
 * is set — they don't overlap on a single category, so the sum reads as
 * "whichever applies". */
function planAt(
  budgetByMonth: Record<string, number> | undefined,
  scheduledByMonth: Record<string, number> | undefined,
  m: string,
): number | undefined {
  const v = (budgetByMonth?.[m] ?? 0) + (scheduledByMonth?.[m] ?? 0);
  return v > 0 ? v : undefined;
}

function CountCell({
  value,
  colHighlight,
  computed,
}: {
  value: number | undefined;
  colHighlight?: boolean;
  computed?: boolean;
}) {
  return (
    <td
      className={`px-2 py-1.5 text-right tabular-nums text-xs text-muted-foreground ${
        colHighlight ? "bg-indigo-500/10 print:bg-transparent" : computed ? "bg-muted/40" : ""
      } ${computed ? "border-l border-border" : ""}`}
    >
      {value ? value : "—"}
    </td>
  );
}

function BudgetCell({ value }: { value?: number }) {
  const { text } = formatAmount(value ? value : undefined, "plain");
  // Plan is always a computed column — left separator + muted bg
  // baked in so callers don't repeat the styling everywhere.
  return (
    <td className="pl-3 pr-1.5 py-1.5 text-right tabular-nums text-muted-foreground/70 bg-muted/40 border-l border-border">
      {text}
    </td>
  );
}

function SectionHeader({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <td
        colSpan={cols}
        className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 sticky left-0"
      >
        {label}
      </td>
    </tr>
  );
}

/** Sum any `Record<string, number>` field across a list of
 *  categories — `byMonth`, `countByMonth`, `budgetByMonth`,
 *  `scheduledByMonth` all collapse through one helper. The
 *  typed `AggregableField` union keeps the field-name
 *  parameter compile-checked. */
type AggregableField =
  | "byMonth"
  | "countByMonth"
  | "budgetByMonth"
  | "scheduledByMonth";

function aggregateField(
  cats: CashflowCategory[],
  field: AggregableField,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cat of cats) {
    for (const [m, v] of Object.entries(cat[field] ?? {})) {
      out[m] = (out[m] ?? 0) + v;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// 3-level hierarchy:
//   GrandparentGroup  (grandparent cats, aggregate header)
//     ParentSubGroup  (parent cats, sub-header, may have own transactions)
//       CashflowCategory  (leaf/grandchild cats)
//   StandaloneGroup   (cats with no parent and no children, or depth-1 with no children)
// ──────────────────────────────────────────────────────────────────────────

interface ParentSubGroup {
  parentId: string;
  parentName: string;
  parentCat?: CashflowCategory; // defined when parent itself has direct transactions
  byMonth: Record<string, number>;
  countByMonth: Record<string, number>;
  total: number;
  totalCount: number;
  budgetTotal: number;
  scheduledTotal: number;
  budgetByMonth: Record<string, number>;
  scheduledByMonth: Record<string, number>;
  children: CashflowCategory[]; // grandchildren (depth-2)
}

interface GrandparentGroup {
  kind: "grandparent";
  grandparentId: string;
  grandparentName: string;
  hasDirect: boolean; // true when the grandparent category itself has direct transactions
  byMonth: Record<string, number>;
  countByMonth: Record<string, number>;
  total: number;
  totalCount: number;
  budgetTotal: number;
  scheduledTotal: number;
  budgetByMonth: Record<string, number>;
  scheduledByMonth: Record<string, number>;
  subGroups: ParentSubGroup[];
}

interface StandaloneGroup { kind: "standalone"; cat: CashflowCategory }

type DisplayGroup = GrandparentGroup | StandaloneGroup;

function sumBudget(cats: CashflowCategory[]): number { return cats.reduce((s, c) => s + c.budgetTotal, 0); }
function sumScheduled(cats: CashflowCategory[]): number { return cats.reduce((s, c) => s + c.scheduledTotal, 0); }

function buildGroups(cats: CashflowCategory[]): DisplayGroup[] {
  const depth0 = cats.filter((c) => !c.parentId);
  const depth1 = cats.filter((c) => c.parentId && !c.grandparentId);
  const depth2 = cats.filter((c) => c.grandparentId);

  const grandchildrenByParentId = new Map<string, CashflowCategory[]>();
  for (const c of depth2) {
    const arr = grandchildrenByParentId.get(c.parentId!) ?? [];
    arr.push(c);
    grandchildrenByParentId.set(c.parentId!, arr);
  }

  const depth1ById = new Map(depth1.map((c) => [c.id, c]));
  const depth0ById = new Map(depth0.map((c) => [c.id, c]));

  // Track every depth-1 cat that gets placed under a parent group so it is never
  // also rendered as standalone (was the double-render bug).
  const handledDepth1Ids = new Set<string>();

  // ── 3-level grandparent groups (depth2 present) ──────────────────────────

  const grandparentIds = new Set<string>();
  for (const c of depth1) {
    if (grandchildrenByParentId.has(c.id)) grandparentIds.add(c.parentId!);
  }
  for (const c of depth2) {
    if (c.grandparentId) grandparentIds.add(c.grandparentId);
  }

  const grandparentGroups = new Map<string, GrandparentGroup>();

  for (const gpId of grandparentIds) {
    const gpCat = depth0ById.get(gpId);
    const grandparentName = gpCat?.name ?? depth2.find((c) => c.grandparentId === gpId)?.grandparentName ?? "Unknown";
    const parentSubs: ParentSubGroup[] = [];

    const depth1Children = depth1.filter((c) => c.parentId === gpId && grandchildrenByParentId.has(c.id));
    for (const p1 of depth1Children) {
      handledDepth1Ids.add(p1.id);
      const grandkids = (grandchildrenByParentId.get(p1.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
      const allInSub = depth1ById.has(p1.id) ? [p1, ...grandkids] : grandkids;
      const byMonth = aggregateField(allInSub, "byMonth");
      const countByMonth = aggregateField(allInSub, "countByMonth");
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
      const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
      parentSubs.push({ parentId: p1.id, parentName: p1.name, parentCat: p1, byMonth, countByMonth, total, totalCount, budgetTotal: sumBudget(allInSub), scheduledTotal: sumScheduled(allInSub), budgetByMonth: aggregateField(allInSub, "budgetByMonth"), scheduledByMonth: aggregateField(allInSub, "scheduledByMonth"), children: grandkids });
    }

    // depth-2 cats whose depth-1 parent has no own transactions
    const depth2UnderGp = depth2.filter((c) => c.grandparentId === gpId);
    const coveredParentIds = new Set(depth1Children.map((c) => c.id));
    for (const c of depth2UnderGp) {
      if (!coveredParentIds.has(c.parentId!)) {
        coveredParentIds.add(c.parentId!);
        const siblings = depth2UnderGp.filter((x) => x.parentId === c.parentId).sort((a, b) => a.name.localeCompare(b.name));
        const byMonth = aggregateField(siblings, "byMonth");
        const countByMonth = aggregateField(siblings, "countByMonth");
        const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
        const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
        parentSubs.push({ parentId: c.parentId!, parentName: c.parentName ?? "Unknown", byMonth, countByMonth, total, totalCount, budgetTotal: sumBudget(siblings), scheduledTotal: sumScheduled(siblings), budgetByMonth: aggregateField(siblings, "budgetByMonth"), scheduledByMonth: aggregateField(siblings, "scheduledByMonth"), children: siblings });
      }
    }

    parentSubs.sort((a, b) => a.parentName.localeCompare(b.parentName));

    const gpOwnCat = depth0ById.get(gpId);
    const allForGp: CashflowCategory[] = gpOwnCat ? [gpOwnCat] : [];
    for (const sub of parentSubs) allForGp.push(...sub.children, ...(sub.parentCat ? [sub.parentCat] : []));
    const gpByMonth = aggregateField(allForGp, "byMonth");
    const gpCountByMonth = aggregateField(allForGp, "countByMonth");
    const gpTotal = Object.values(gpByMonth).reduce((s, v) => s + v, 0);
    const gpTotalCount = Object.values(gpCountByMonth).reduce((s, v) => s + v, 0);

    grandparentGroups.set(gpId, { kind: "grandparent", grandparentId: gpId, grandparentName, hasDirect: gpOwnCat !== undefined, byMonth: gpByMonth, countByMonth: gpCountByMonth, total: gpTotal, totalCount: gpTotalCount, budgetTotal: sumBudget(allForGp), scheduledTotal: sumScheduled(allForGp), budgetByMonth: aggregateField(allForGp, "budgetByMonth"), scheduledByMonth: aggregateField(allForGp, "scheduledByMonth"), subGroups: parentSubs });
  }

  const depth0IdsAsGrandparents = new Set(grandparentGroups.keys());

  const depth1ByParentId = new Map<string, CashflowCategory[]>();
  for (const c of depth1) {
    const arr = depth1ByParentId.get(c.parentId!) ?? [];
    arr.push(c);
    depth1ByParentId.set(c.parentId!, arr);
  }

  const groups: DisplayGroup[] = [...grandparentGroups.values()];

  // ── 2-level parent groups (depth0 cat that has depth-1 children) ──────────

  for (const cat of depth0) {
    if (depth0IdsAsGrandparents.has(cat.id)) continue;
    const kids = (depth1ByParentId.get(cat.id) ?? []).filter((k) => !handledDepth1Ids.has(k.id));
    if (kids.length === 0) {
      groups.push({ kind: "standalone", cat });
    } else {
      const subGroups: ParentSubGroup[] = kids
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((k) => {
          handledDepth1Ids.add(k.id);
          const byMonth = aggregateField([k], "byMonth");
          const countByMonth = aggregateField([k], "countByMonth");
          const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
          const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
          return { parentId: k.id, parentName: k.name, parentCat: k, byMonth, countByMonth, total, totalCount, budgetTotal: k.budgetTotal, scheduledTotal: k.scheduledTotal, budgetByMonth: { ...k.budgetByMonth }, scheduledByMonth: { ...k.scheduledByMonth }, children: [] };
        });
      const allForGp: CashflowCategory[] = [cat, ...subGroups.flatMap((s) => s.parentCat ? [s.parentCat] : [])];
      const gpByMonth = aggregateField(allForGp, "byMonth");
      const gpCountByMonth = aggregateField(allForGp, "countByMonth");
      const gpTotal = Object.values(gpByMonth).reduce((s, v) => s + v, 0);
      const gpTotalCount = Object.values(gpCountByMonth).reduce((s, v) => s + v, 0);
      groups.push({ kind: "grandparent", grandparentId: cat.id, grandparentName: cat.name, hasDirect: true, byMonth: gpByMonth, countByMonth: gpCountByMonth, total: gpTotal, totalCount: gpTotalCount, budgetTotal: sumBudget(allForGp), scheduledTotal: sumScheduled(allForGp), budgetByMonth: aggregateField(allForGp, "budgetByMonth"), scheduledByMonth: aggregateField(allForGp, "scheduledByMonth"), subGroups });
    }
  }

  // ── Remaining depth-1 cats: parent has no transactions in this period ─────
  // Group by parentId to create a synthetic parent header row.

  const unhandledByParent = new Map<string, CashflowCategory[]>();
  for (const cat of depth1) {
    if (handledDepth1Ids.has(cat.id)) continue;
    if (!cat.parentId) { groups.push({ kind: "standalone", cat }); continue; }
    const arr = unhandledByParent.get(cat.parentId) ?? [];
    arr.push(cat);
    unhandledByParent.set(cat.parentId, arr);
  }

  for (const [parentId, kids] of unhandledByParent) {
    const parentName = kids[0].parentName ?? "Unknown";
    const sorted = kids.sort((a, b) => a.name.localeCompare(b.name));
    const newSubGroups: ParentSubGroup[] = sorted.map((k) => {
      const byMonth = aggregateField([k], "byMonth");
      const countByMonth = aggregateField([k], "countByMonth");
      const total = Object.values(byMonth).reduce((s, v) => s + v, 0);
      const totalCount = Object.values(countByMonth).reduce((s, v) => s + v, 0);
      return { parentId: k.id, parentName: k.name, parentCat: k, byMonth, countByMonth, total, totalCount, budgetTotal: k.budgetTotal, scheduledTotal: k.scheduledTotal, budgetByMonth: { ...k.budgetByMonth }, scheduledByMonth: { ...k.scheduledByMonth }, children: [] };
    });

    const existing = grandparentGroups.get(parentId);
    if (existing) {
      for (const sg of newSubGroups) existing.subGroups.push(sg);
      existing.subGroups.sort((a, b) => a.parentName.localeCompare(b.parentName));
      const gpOwnCat = depth0ById.get(parentId);
      const allForGp: CashflowCategory[] = gpOwnCat ? [gpOwnCat] : [];
      for (const sub of existing.subGroups) {
        allForGp.push(...sub.children, ...(sub.parentCat ? [sub.parentCat] : []));
      }
      existing.byMonth = aggregateField(allForGp, "byMonth");
      existing.countByMonth = aggregateField(allForGp, "countByMonth");
      existing.total = Object.values(existing.byMonth).reduce((s, v) => s + v, 0);
      existing.totalCount = Object.values(existing.countByMonth).reduce((s, v) => s + v, 0);
      existing.budgetTotal = sumBudget(allForGp);
      existing.scheduledTotal = sumScheduled(allForGp);
      existing.budgetByMonth = aggregateField(allForGp, "budgetByMonth");
      existing.scheduledByMonth = aggregateField(allForGp, "scheduledByMonth");
    } else {
      const gpByMonth = aggregateField(sorted, "byMonth");
      const gpCountByMonth = aggregateField(sorted, "countByMonth");
      const gpTotal = Object.values(gpByMonth).reduce((s, v) => s + v, 0);
      const gpTotalCount = Object.values(gpCountByMonth).reduce((s, v) => s + v, 0);
      groups.push({ kind: "grandparent", grandparentId: parentId, grandparentName: parentName, hasDirect: false, byMonth: gpByMonth, countByMonth: gpCountByMonth, total: gpTotal, totalCount: gpTotalCount, budgetTotal: sumBudget(sorted), scheduledTotal: sumScheduled(sorted), budgetByMonth: aggregateField(sorted, "budgetByMonth"), scheduledByMonth: aggregateField(sorted, "scheduledByMonth"), subGroups: newSubGroups });
    }
  }

  groups.sort((a, b) => {
    const nameA = a.kind === "standalone" ? a.cat.name : a.grandparentName;
    const nameB = b.kind === "standalone" ? b.cat.name : b.grandparentName;
    return nameA.localeCompare(nameB);
  });

  return groups;
}

/** Signed Diff for a single month: (signed actual) − (signed plan).
 *  Plan amounts arrive as unsigned positives from the API, so they
 *  get the row's direction (negate=true ⇒ expense ⇒ negative)
 *  applied before subtracting from the already-signed actual. The
 *  result reads cleanly through `amountClass` / `mode="net"`:
 *  positive = under (expense) or surplus (income); negative =
 *  over / shortfall. Matches the Category report convention. */
function monthDiff(
  actual: number | undefined,
  plan: number | undefined,
  negate: boolean,
): number | undefined {
  if (actual === undefined && (plan === undefined || plan === 0)) return undefined;
  const a = actual ?? 0;
  const p = (plan ?? 0) * (negate ? -1 : 1);
  return a - p;
}

/** Signed Diff total over the report window. Sums planAt across
 *  the months (matches the Category report fix that prefers the
 *  per-month sum over `planPerMonth × months.length`). */
function totalDiff(
  total: number,
  budgetByMonth: Record<string, number> | undefined,
  scheduledByMonth: Record<string, number> | undefined,
  months: string[],
  negate: boolean,
): number {
  const planSum = months.reduce(
    (s, m) => s + (planAt(budgetByMonth, scheduledByMonth, m) ?? 0),
    0,
  );
  return total - planSum * (negate ? -1 : 1);
}

/** Per-month cell block shared by `ParentHeaderRow`,
 *  `SubParentHeaderRow`, and `LeafRow`. Renders the
 *  [Plan? · Actual · Diff? · Count?] fragment per month
 *  with consistent column highlighting + border / muted /
 *  overPlan behaviour. `TotalsRow` opts out and keeps its
 *  own loop — its placeholder cells for Plan / Diff don't
 *  fit this abstraction cleanly.
 *
 *  Pre-applied "no data" view: callers that want to hide
 *  values (e.g. parent / sub-parent rows at a totalsLevel
 *  that suppresses them) pass `byMonth={}` /
 *  `budgetByMonth={}` / `scheduledByMonth={}` instead of a
 *  separate `showValues` flag. Empty objects naturally
 *  render every cell as `—` via `formatAmount`. */
function MonthCells({
  months,
  thisMonth,
  byMonth,
  budgetByMonth,
  scheduledByMonth,
  countByMonth,
  negate,
  onOpenMonth,
  mutedActual,
}: {
  months: string[];
  thisMonth: string;
  byMonth: Record<string, number>;
  budgetByMonth?: Record<string, number>;
  scheduledByMonth?: Record<string, number>;
  /** Optional — when present, the Counts column renders a
   *  `CountCell` with the per-month count. When absent (e.g.
   *  on a parent / sub-parent header row where counts aren't
   *  the row's own — they belong to its leaves), an empty
   *  placeholder `<td>` is rendered to keep column alignment. */
  countByMonth?: Record<string, number>;
  negate?: boolean;
  onOpenMonth?: (m: string) => void;
  /** Parent / sub-parent rows render the Actual cell as
   *  muted (de-emphasised vs leaf rows). Leaf rows omit this
   *  so the actual amount reads in foreground. */
  mutedActual?: boolean;
}) {
  const opts = useColOpts();
  return (
    <>
      {months.map((m) => {
        const plan = planAt(budgetByMonth, scheduledByMonth, m);
        const actual = byMonth[m];
        const diff = monthDiff(actual, plan, !!negate);
        return (
          <Fragment key={m}>
            {opts.showPlan && (
              <MonthSubCell value={plan} colHighlight={m === thisMonth} borderLeft />
            )}
            <AmountCell
              value={actual}
              negate={negate}
              colHighlight={m === thisMonth}
              muted={mutedActual}
              borderLeft={!opts.showPlan}
              onClick={onOpenMonth ? () => onOpenMonth(m) : undefined}
            />
            {opts.showDiff && (
              <AmountCell
                value={diff}
                mode="plain"
                compact
                computed
                colHighlight={m === thisMonth}
              />
            )}
            {opts.showCounts &&
              (countByMonth ? (
                <CountCell
                  value={countByMonth[m]}
                  colHighlight={m === thisMonth}
                />
              ) : (
                <td
                  className={
                    m === thisMonth
                      ? "bg-indigo-500/10 print:bg-transparent"
                      : ""
                  }
                />
              ))}
          </Fragment>
        );
      })}
    </>
  );
}

function ParentHeaderRow({
  name, months, byMonth, countByMonth, total, totalCount, thisMonth,
  negate, href, grandparent, hasDirect, showValues = true,
  budgetTotal, scheduledTotal, budgetByMonth, scheduledByMonth,
  isCollapsed, onToggle, categoryIdForCell, fromForCell, toForCell,
  hideTargetId, isHidden,
}: {
  name: string;
  months: string[];
  byMonth: Record<string, number>;
  countByMonth: Record<string, number>;
  total: number;
  totalCount: number;
  thisMonth: string;
  negate?: boolean;
  href?: string;
  grandparent?: boolean;
  hasDirect?: boolean;
  showValues?: boolean;
  budgetTotal?: number;
  scheduledTotal?: number;
  budgetByMonth?: Record<string, number>;
  scheduledByMonth?: Record<string, number>;
  isCollapsed?: boolean;
  onToggle?: () => void;
  /** When set, value cells become drill-throughs that include descendant
   * categories. Skipped on synthetic rows that don't map to a real id. */
  categoryIdForCell?: string;
  fromForCell?: string;
  toForCell?: string;
  /** When set, an eye icon next to the name toggles this category's
   * exclusion from the report. Synthetic rows (no DB id) omit it. */
  hideTargetId?: string;
  isHidden?: boolean;
}) {
  const opts = useColOpts();
  const display = (v: number | undefined) => (negate && v !== undefined ? -v : v);
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
  const nameColor = "text-muted-foreground";
  const open = useCellOpener();
  const openMonth = open && categoryIdForCell
    ? (m: string) => {
        const r = monthRange(m);
        open({
          categoryId: categoryIdForCell,
          includeChildren: true,
          from: r.from,
          to: r.to,
          rangeLabel: r.label,
          displayName: name,
        });
      }
    : undefined;
  const openTotal = open && categoryIdForCell && fromForCell && toForCell
    ? () =>
        open({
          categoryId: categoryIdForCell,
          includeChildren: true,
          from: fromForCell,
          to: toForCell,
          rangeLabel: totalRangeLabel(fromForCell, toForCell),
          displayName: name,
        })
    : undefined;
  return (
    <tr
      className={`group border-b ${grandparent ? "border-border bg-muted/30" : "border-border/50"} ${onToggle ? "cursor-pointer" : ""} ${isHidden ? "opacity-50" : ""}`}
      onClick={onToggle}
    >
      <td className={`px-3 py-1.5 text-sm sticky left-0 whitespace-nowrap ${grandparent ? `font-semibold bg-muted/30 ${nameColor}` : `font-medium bg-background ${nameColor}`}`}>
        <span className="flex items-center gap-1 min-w-0">
          {onToggle && <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {href ? (
            <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-indigo-600 transition-colors">
              {name}
            </Link>
          ) : name}
          {hideTargetId && <HideEye catId={hideTargetId} isHidden={!!isHidden} />}
        </span>
      </td>
      {opts.monthAxis && (
        <MonthCells
          months={months}
          thisMonth={thisMonth}
          byMonth={showValues ? byMonth : {}}
          budgetByMonth={showValues ? budgetByMonth : undefined}
          scheduledByMonth={showValues ? scheduledByMonth : undefined}
          negate={negate}

          onOpenMonth={showValues ? openMonth : undefined}
          mutedActual
        />
      )}
      <AmountCell
        value={showValues ? display(total) : undefined}
        muted
        computed
        onClick={showValues ? openTotal : undefined}
      />
      {opts.showCounts && <td className="bg-muted/40 border-l border-border" />}
      {opts.showAvg && <AmountCell value={showValues && months.length > 0 ? display(total / months.length) : undefined} muted computed />}
      {opts.showPlan && (
        <BudgetCell value={(budgetTotal ?? 0) + (scheduledTotal ?? 0)} />
      )}
      {opts.showDiff && (
        <AmountCell
          value={
            showValues
              ? totalDiff(total, budgetByMonth, scheduledByMonth, months, !!negate)
              : undefined
          }
          mode="plain"
          compact
          computed
        />
      )}
    </tr>
  );
}

function SubParentHeaderRow({
  sub, months, thisMonth, negate, from, to,
  showValues = true, isCollapsed, onToggle, isHidden,
}: {
  sub: ParentSubGroup;
  months: string[];
  thisMonth: string;
  negate?: boolean;
  from: string;
  to: string;
  showValues?: boolean;
  isCollapsed?: boolean;
  onToggle?: () => void;
  isHidden?: boolean;
}) {
  const opts = useColOpts();
  const display = (v: number | undefined) => (negate && v !== undefined ? -v : v);
  // URL-encode every interpolated value even though they're DB-
  // controlled (UUIDs and ISO dates). Keeps the href provably safe
  // for the React `<Link>` href dataflow that CodeQL's
  // js/xss-through-dom checker walks.
  const href = sub.parentCat
    ? `/transactions?categoryId=${encodeURIComponent(sub.parentCat.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    : undefined;
  const Chevron = isCollapsed ? ChevronRight : ChevronDown;
  const nameColor = "text-muted-foreground";
  const open = useCellOpener();
  const openMonth = open
    ? (m: string) => {
        const r = monthRange(m);
        open({
          categoryId: sub.parentId,
          includeChildren: true,
          from: r.from,
          to: r.to,
          rangeLabel: r.label,
          displayName: sub.parentName,
        });
      }
    : undefined;
  const openTotal = open
    ? () =>
        open({
          categoryId: sub.parentId,
          includeChildren: true,
          from,
          to,
          rangeLabel: totalRangeLabel(from, to),
          displayName: sub.parentName,
        })
    : undefined;
  return (
    <tr className={`group border-b border-border/50 ${onToggle ? "cursor-pointer" : ""} ${isHidden ? "opacity-50" : ""}`} onClick={onToggle}>
      <td className={`pl-9 pr-3 py-1.5 text-sm font-medium sticky left-0 bg-background whitespace-nowrap ${nameColor}`}>
        <span className="flex items-center gap-1 min-w-0">
          {onToggle && <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />}
          {href ? (
            <Link href={href} onClick={(e) => e.stopPropagation()} className="hover:underline hover:text-indigo-600 transition-colors">
              {sub.parentName}
            </Link>
          ) : sub.parentName}
          <HideEye catId={sub.parentId} isHidden={!!isHidden} />
        </span>
      </td>
      {opts.monthAxis && (
        <MonthCells
          months={months}
          thisMonth={thisMonth}
          byMonth={showValues ? sub.byMonth : {}}
          budgetByMonth={sub.budgetByMonth}
          scheduledByMonth={sub.scheduledByMonth}
          negate={negate}

          onOpenMonth={showValues ? openMonth : undefined}
          mutedActual
        />
      )}
      <AmountCell
        value={showValues ? display(sub.total) : undefined}
        muted
        computed
        onClick={showValues ? openTotal : undefined}
      />
      {opts.showCounts && <td className="bg-muted/40 border-l border-border" />}
      {opts.showAvg && <AmountCell value={showValues && months.length > 0 ? display(sub.total / months.length) : undefined} muted computed />}
      {opts.showPlan && <BudgetCell value={sub.budgetTotal + sub.scheduledTotal} />}
      {opts.showDiff && (
        <AmountCell
          value={
            showValues
              ? totalDiff(sub.total, sub.budgetByMonth, sub.scheduledByMonth, months, !!negate)
              : undefined
          }
          mode="plain"
          compact
          computed
        />
      )}
    </tr>
  );
}

function LeafRow({
  cat, months, thisMonth, negate, from, to, indent, isHidden,
}: {
  cat: CashflowCategory;
  months: string[];
  thisMonth: string;
  negate?: boolean;
  from: string;
  to: string;
  indent: "none" | "child" | "grandchild";
  isHidden?: boolean;
}) {
  const opts = useColOpts();
  // Uncategorised synthetic rows ("uncategorised-income"/"uncategorised-expenses")
  // get a clickthrough to the transactions page filtered by NULL category, with
  // a direction filter so income and expense each open their own slice.
  const isUncategorised = cat.id.startsWith("uncategorised-");
  const uncatDirection = cat.id === "uncategorised-income"
    ? "in"
    : cat.id === "uncategorised-expenses"
      ? "out"
      : null;
  const cellCategoryId = isUncategorised ? "__uncat__" : cat.id;
  // URL-encode the interpolated values (see the matching comment in
  // the parent-row href above).
  const href = isUncategorised
    ? `/transactions?categoryId=__uncat__&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${uncatDirection ? `&direction=${encodeURIComponent(uncatDirection)}` : ""}`
    : `/transactions?categoryId=${encodeURIComponent(cat.id)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const nameEl = isUncategorised
    ? <Link href={href} className="text-muted-foreground hover:underline hover:text-foreground transition-colors">{cat.name}</Link>
    : <Link href={href} className="hover:underline hover:text-indigo-600 transition-colors">{cat.name}</Link>;
  const tdClass =
    indent === "grandchild" ? "pl-16 pr-3 py-1.5 text-sm sticky left-0 bg-background whitespace-nowrap"
    : indent === "child"    ? "pl-9 pr-3 py-1.5 text-sm sticky left-0 bg-background whitespace-nowrap"
    :                         "px-3 py-1.5 text-sm sticky left-0 bg-background whitespace-nowrap";
  const open = useCellOpener();
  const openMonth = open
    ? (m: string) => {
        const r = monthRange(m);
        open({
          categoryId: cellCategoryId,
          from: r.from,
          to: r.to,
          rangeLabel: r.label,
          displayName: cat.name,
          direction: uncatDirection ?? undefined,
        });
      }
    : undefined;
  const openTotal = open
    ? () =>
        open({
          categoryId: cellCategoryId,
          from,
          to,
          rangeLabel: totalRangeLabel(from, to),
          displayName: cat.name,
          direction: uncatDirection ?? undefined,
        })
    : undefined;
  return (
    <tr className={`group hover:bg-muted/30 border-b border-border/50 ${isHidden ? "opacity-50" : ""}`}>
      <td className={tdClass}>
        <span className="flex items-center gap-1 min-w-0">
          <span className="truncate">{nameEl}</span>
          {!isUncategorised && <TagIndicator catId={cat.id} />}
          {!isUncategorised && (
            <span className="ml-auto flex items-center gap-0.5 shrink-0">
              <CategoryTagsPopover catId={cat.id} catName={cat.name} />
              <HideEye catId={cat.id} isHidden={!!isHidden} />
            </span>
          )}
        </span>
      </td>
      {opts.monthAxis && (
        <MonthCells
          months={months}
          thisMonth={thisMonth}
          byMonth={cat.byMonth}
          budgetByMonth={cat.budgetByMonth}
          scheduledByMonth={cat.scheduledByMonth}
          countByMonth={cat.countByMonth}
          negate={negate}

          onOpenMonth={openMonth}
        />
      )}
      <AmountCell value={cat.total} negate={negate} computed onClick={openTotal} />
      {opts.showCounts && <CountCell value={cat.totalCount} computed />}
      {opts.showAvg && <AmountCell value={months.length > 0 ? cat.total / months.length : undefined} negate={negate} muted computed />}
      {opts.showPlan && <BudgetCell value={cat.budgetTotal + cat.scheduledTotal} />}
      {opts.showDiff && (
        <AmountCell
          value={totalDiff(cat.total, cat.budgetByMonth, cat.scheduledByMonth, months, !!negate)}
          mode="plain"
          compact
          computed
        />
      )}
    </tr>
  );
}

/** Row for a virtual tag view rendered below the main Cashflow
 *  table. Similar cell shape to `LeafRow` but signed (values are
 *  already signed — no `negate`), no plan/budget/scheduled cells
 *  (virtual rows aggregate real cats' actuals only), no drill-
 *  through (v1). When `isEnabled` is false the row is greyed out
 *  and its values are visually muted, matching the Hidden section
 *  convention. See src/lib/reports/virtual-rows.ts. */
function VirtualTagRow({
  row,
  months,
  thisMonth,
  isEnabled,
  onToggle,
  categoryPathById,
  catById,
  from,
  to,
}: {
  row: {
    tag: string;
    memberCategoryIds: string[];
    byMonth: Record<string, number>;
    total: number;
  };
  months: string[];
  thisMonth: string;
  isEnabled: boolean;
  onToggle: () => void;
  /** Map of category id → full ancestry path ("Grandparent › Parent
   * › Leaf") — same format as buildCategoryPathStringMap so a tag
   * touching two categories both named "Insurance" is disambiguated
   * by its parent chain. */
  categoryPathById: Record<string, string>;
  /** Full CashflowCategory lookup — needed so each member sub-row
   * can render its own per-month cells with real data. */
  catById: Map<string, CashflowCategory>;
  from: string;
  to: string;
}) {
  const opts = useColOpts();
  const opacity = isEnabled ? "" : "opacity-50";
  // Members sorted by path so the sub-list is stable + readable.
  // Missing cats (deleted between report fetch and tag save) get a
  // fallback path.
  const members = [...row.memberCategoryIds]
    .map((id) => ({
      id,
      path: categoryPathById[id] ?? id,
      cat: catById.get(id),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return (
    <>
      {/* Aggregate row: the tag's summed values across all
          members. Excluded from Total Income / Total Expenses /
          Surplus math regardless of toggle state. */}
      <tr
        className={`group hover:bg-muted/30 border-b border-border/50 ${opacity}`}
      >
        <td className="px-3 py-1.5 text-sm sticky left-0 bg-background whitespace-nowrap">
          <span className="flex items-center gap-1 min-w-0">
            <span className="truncate font-medium">#{row.tag}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className={`ml-1 p-0.5 rounded hover:bg-muted transition-opacity print:hidden ${
                isEnabled
                  ? "opacity-0 group-hover:opacity-60 hover:opacity-100 lg:opacity-0 lg:group-hover:opacity-60"
                  : "opacity-70 hover:opacity-100"
              }`}
              title={isEnabled ? "Hide this tag row" : "Show this tag row"}
              aria-label={isEnabled ? "Hide tag row" : "Show tag row"}
              aria-pressed={isEnabled}
            >
              {isEnabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
          </span>
        </td>
        {opts.monthAxis && (
          <MonthCells
            months={months}
            thisMonth={thisMonth}
            byMonth={row.byMonth}
            budgetByMonth={{}}
            scheduledByMonth={{}}
            countByMonth={{}}
          />
        )}
        <AmountCell value={row.total} mode="net" computed />
        {opts.showCounts && (
          <td className="pl-3 pr-1.5 py-1.5 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border">—</td>
        )}
        {opts.showAvg && (
          <AmountCell value={months.length > 0 ? row.total / months.length : undefined} mode="net" muted computed />
        )}
        {opts.showPlan && (
          <td className="pl-3 pr-1.5 py-1.5 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border">—</td>
        )}
        {opts.showDiff && (
          <td className="pl-3 pr-1.5 py-1.5 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border">—</td>
        )}
      </tr>
      {/* Member sub-rows: one per contributing category, small font,
          indented, showing the same column suite as the aggregate.
          Signed values (income positive, expense negative) so the
          member's contribution reads with the correct sign; no
          `negate` here — mirrors the aggregate's convention. */}
      {members.map(({ id, path, cat }) => (
        <VirtualTagMemberRow
          key={id}
          catId={id}
          path={path}
          cat={cat}
          months={months}
          thisMonth={thisMonth}
          opacity={opacity}
          from={from}
          to={to}
        />
      ))}
    </>
  );
}

/** Sub-row rendered under each virtual tag aggregate. Small font,
 *  indented bullet, full per-month + total + avg columns matching
 *  the parent columns of the Cashflow table. A missing `cat`
 *  (member id no longer in the current cashflow response — e.g. the
 *  member was tagged but has no activity in the window) still
 *  renders as a name-only row with dashes in the numeric cells so
 *  the operator can see the tag membership. */
function VirtualTagMemberRow({
  catId,
  path,
  cat,
  months,
  thisMonth,
  opacity,
  from,
  to,
}: {
  catId: string;
  path: string;
  cat: CashflowCategory | undefined;
  months: string[];
  thisMonth: string;
  opacity: string;
  from: string;
  to: string;
}) {
  const opts = useColOpts();
  const open = useCellOpener();
  const openMonth =
    open && cat
      ? (m: string) => {
          const r = monthRange(m);
          open({
            categoryId: catId,
            from: r.from,
            to: r.to,
            rangeLabel: r.label,
            displayName: path,
          });
        }
      : undefined;
  const openTotal =
    open && cat
      ? () =>
          open({
            categoryId: catId,
            from,
            to,
            rangeLabel: totalRangeLabel(from, to),
            displayName: path,
          })
      : undefined;
  return (
    <tr className={`hover:bg-muted/20 border-b border-border/30 text-[11px] ${opacity}`}>
      <td className="pl-9 pr-3 py-1 sticky left-0 bg-background whitespace-nowrap text-muted-foreground">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span aria-hidden="true">•</span>
          <span className="truncate">{path}</span>
        </span>
      </td>
      {opts.monthAxis &&
        (cat ? (
          <MonthCells
            months={months}
            thisMonth={thisMonth}
            byMonth={cat.byMonth}
            budgetByMonth={{}}
            scheduledByMonth={{}}
            countByMonth={{}}
            onOpenMonth={openMonth}
          />
        ) : (
          months.map((m) => (
            <td
              key={m}
              className={`px-2 py-1 text-right text-muted-foreground/50 tabular-nums ${m === thisMonth ? "bg-indigo-500/10" : ""}`}
            >
              —
            </td>
          ))
        ))}
      <AmountCell
        value={cat?.total}
        mode="net"
        computed
        compact
        onClick={openTotal}
      />
      {opts.showCounts && (
        <td className="pl-3 pr-1.5 py-1 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border text-[11px]">—</td>
      )}
      {opts.showAvg && (
        <AmountCell
          value={cat && months.length > 0 ? cat.total / months.length : undefined}
          mode="net"
          muted
          computed
          compact
        />
      )}
      {opts.showPlan && (
        <td className="pl-3 pr-1.5 py-1 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border text-[11px]">—</td>
      )}
      {opts.showDiff && (
        <td className="pl-3 pr-1.5 py-1 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border text-[11px]">—</td>
      )}
    </tr>
  );
}

function TotalsRow({
  label, months, values, thisMonth, mode, negate,
}: {
  label: string;
  months: string[];
  values: Record<string, number>;
  thisMonth: string;
  mode?: "plain" | "net" | "balance";
  negate?: boolean;
}) {
  const opts = useColOpts();
  const total = Object.values(values).reduce((s, v) => s + v, 0);
  const avg = months.length > 0 ? total / months.length : undefined;
  return (
    <tr className="border-t-2 border-border font-semibold">
      <td className="px-3 py-2 text-sm sticky left-0 bg-muted/40 whitespace-nowrap">{label}</td>
      {opts.monthAxis &&
        months.map((m) => (
          <Fragment key={m}>
            {opts.showPlan && <td className={`px-2 py-2 border-l border-border ${m === thisMonth ? "bg-indigo-500/10 print:bg-transparent" : ""}`} />}
            <AmountCell value={values[m]} colHighlight={m === thisMonth} mode={mode} negate={negate} borderLeft={!opts.showPlan} />
            {opts.showDiff && (
              <td className={`px-2 py-2 bg-muted/40 border-l border-border ${m === thisMonth ? "bg-indigo-500/10 print:bg-transparent" : ""}`} />
            )}
            {opts.showCounts && <td className={`px-2 py-2 ${m === thisMonth ? "bg-indigo-500/10 print:bg-transparent" : ""}`} />}
          </Fragment>
        ))}
      {mode === "balance" ? (
        <td className="pl-3 pr-1.5 py-2 text-right text-muted-foreground tabular-nums bg-muted/40 border-l border-border">—</td>
      ) : (
        <AmountCell value={total} mode={mode} negate={negate} computed />
      )}
      {opts.showCounts && <td className="px-2 py-2 bg-muted/40 border-l border-border" />}
      {opts.showAvg && (mode === "balance" ? (
        <td className="pl-3 pr-1.5 py-2 text-right text-muted-foreground tabular-nums bg-muted/40 border-l border-border">—</td>
      ) : (
        <AmountCell value={avg} mode={mode} negate={negate} muted computed />
      ))}
      {opts.showPlan && <td className="pl-3 pr-1.5 py-2 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border">—</td>}
      {opts.showDiff && <td className="pl-3 pr-1.5 py-2 text-right text-muted-foreground/50 tabular-nums bg-muted/40 border-l border-border">—</td>}
    </tr>
  );
}

type TotalsLevel = "grandparent" | "parent" | "none";

interface ColOpts {
  showCounts: boolean;
  showAvg: boolean;
  showPlan: boolean;
  /** Per-month Diff cells + a row-end Diff total cell. Only set
   *  when `cashflowPlanMode === "diff"`. */
  showDiff: boolean;
  /** When false, every per-month cell block in every row
   *  component is skipped. Used by the Category tab so the same
   *  renderer produces a "totals only" view. */
  monthAxis: boolean;
}

interface CollapseState {
  collapsedGps: Set<string>;
  collapsedSubs: Set<string>;
  onToggleGp: (id: string) => void;
  onToggleSub: (id: string) => void;
}

function renderGroups(
  groups: DisplayGroup[],
  months: string[],
  thisMonth: string,
  negate: boolean,
  from: string,
  to: string,
  totalsLevel: TotalsLevel,
  collapse: CollapseState,
  isHiddenCat: (id: string) => boolean,
) {
  return groups.map((g) => {
    if (g.kind === "standalone") {
      return (
        <LeafRow
          key={g.cat.id}
          cat={g.cat}
          months={months}
          thisMonth={thisMonth}
          negate={negate}
          from={from}
          to={to}
          indent="none"
          isHidden={isHiddenCat(g.cat.id)}
        />
      );
    }

    return (
      <GrandparentRows
        key={`gp-${g.grandparentId}`}
        group={g}
        months={months}
        thisMonth={thisMonth}
        negate={negate}
        from={from}
        to={to}
        totalsLevel={totalsLevel}
        collapse={collapse}
        isHiddenCat={isHiddenCat}
      />
    );
  });
}

function GrandparentRows({
  group, months, thisMonth, negate, from, to, totalsLevel, collapse, isHiddenCat,
}: {
  group: GrandparentGroup;
  months: string[];
  thisMonth: string;
  negate: boolean;
  from: string;
  to: string;
  totalsLevel: TotalsLevel;
  collapse: CollapseState;
  isHiddenCat: (id: string) => boolean;
}) {
  const isGpCollapsed = collapse.collapsedGps.has(group.grandparentId);
  const gpHidden = isHiddenCat(group.grandparentId);

  return (
    <>
      <ParentHeaderRow
        name={group.grandparentName}
        months={months}
        byMonth={group.byMonth}
        countByMonth={group.countByMonth}
        total={group.total}
        totalCount={group.totalCount}
        thisMonth={thisMonth}
        negate={negate}
        grandparent
        hasDirect={group.hasDirect}
        href={
          group.hasDirect
            ? `/transactions?categoryId=${encodeURIComponent(group.grandparentId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
            : undefined
        }
        showValues={totalsLevel === "grandparent"}

        budgetTotal={group.budgetTotal}
        scheduledTotal={group.scheduledTotal}
        budgetByMonth={group.budgetByMonth}
        scheduledByMonth={group.scheduledByMonth}
        isCollapsed={isGpCollapsed}
        onToggle={() => collapse.onToggleGp(group.grandparentId)}
        categoryIdForCell={group.grandparentId}
        fromForCell={from}
        toForCell={to}
        hideTargetId={group.grandparentId}
        isHidden={gpHidden}
      />
      {!isGpCollapsed && group.subGroups.map((sub) => {
        if (sub.children.length === 0) {
          return sub.parentCat ? (
            <LeafRow
              key={sub.parentId}
              cat={sub.parentCat}
              months={months}
              thisMonth={thisMonth}
              negate={negate}
              from={from}
              to={to}

              indent="child"
              isHidden={gpHidden || isHiddenCat(sub.parentCat.id)}
            />
          ) : null;
        }
        const isSubCollapsed = collapse.collapsedSubs.has(sub.parentId);
        const subHidden = gpHidden || isHiddenCat(sub.parentId);
        return (
          <Fragment key={`sub-${sub.parentId}`}>
            <SubParentHeaderRow
              sub={sub}
              months={months}
              thisMonth={thisMonth}
              negate={negate}
              from={from}
              to={to}
              showValues={totalsLevel !== "none"}

              isCollapsed={isSubCollapsed}
              onToggle={() => collapse.onToggleSub(sub.parentId)}
              isHidden={subHidden}
            />
            {!isSubCollapsed && sub.children.map((gc) => (
              <LeafRow
                key={gc.id}
                cat={gc}
                months={months}
                thisMonth={thisMonth}
                negate={negate}
                from={from}
                to={to}

                indent="grandchild"
                isHidden={subHidden || isHiddenCat(gc.id)}
              />
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

export function CashflowReport({
  from,
  to,
  accountIds,
  monthAxis = true,
}: {
  from: string;
  to: string;
  accountIds: string[];
  /** When false, the per-month columns (header + every row's
   *  per-month cells) are dropped — the table renders one row per
   *  category with only the row-end Total / Avg / Plan / Diff.
   *  The Category tab is `<CashflowReport monthAxis={false} />`
   *  so both tabs share one implementation; the only difference
   *  is whether the months show. */
  monthAxis?: boolean;
}) {
  // All view toggles for the Cash Flow report tab now live in the
  // DB-backed display-prefs blob, so they follow the operator across
  // devices instead of drifting between browser localStorages.
  const { prefs: displayPrefs, setPref } = useDisplayPrefs();
  const totalsLevel = displayPrefs.cashflowTotalsLevel;
  const showCounts = displayPrefs.cashflowShowCounts;
  const showAvg = displayPrefs.cashflowShowAvg;
  const planMode = displayPrefs.cashflowPlanMode;
  // Derived flags keep the existing renderer code paths simple —
  // every site that used to switch on `showPlan` keeps working,
  // and the new `showDiff` cells light up only in `"diff"` mode.
  const showPlan = planMode !== "off";
  const showDiff = planMode === "diff";
  const showHidden = displayPrefs.cashflowShowHidden;
  const excludedIds = displayPrefs.cashflowExcludedCatIds;
  const hideTransfers = displayPrefs.cashflowHideTransfers;

  function toggleShowCounts() {
    setPref("cashflowShowCounts", !showCounts);
  }
  function toggleShowAvg() {
    setPref("cashflowShowAvg", !showAvg);
  }
  function setPlanMode(mode: "off" | "plan" | "diff") {
    setPref("cashflowPlanMode", mode);
  }
  function toggleShowHidden() {
    setPref("cashflowShowHidden", !showHidden);
  }
  function toggleHideCat(catId: string) {
    const next = excludedIds.includes(catId)
      ? excludedIds.filter((x) => x !== catId)
      : [...excludedIds, catId];
    setPref("cashflowExcludedCatIds", next);
  }
  function changeTotalsLevel(level: TotalsLevel) {
    setPref("cashflowTotalsLevel", level);
  }

  const {
    ids: collapsedGps,
    toggle: toggleGp,
    set: setCollapsedGps,
  } = useToggleSet();
  const {
    ids: collapsedSubs,
    toggle: toggleSub,
    set: setCollapsedSubs,
  } = useToggleSet();
  const [cellQuery, setCellQuery] = useState<CashflowCellQuery | null>(null);

  const opts: ColOpts = { showCounts, showAvg, showPlan, showDiff, monthAxis };

  const accountIdsParam = accountIds.length > 0 ? `&accountIds=${accountIds.join(",")}` : "";
  const { data, isLoading } = useSwrJson<CashflowData>(
    `/api/reports/cashflow?from=${from}&to=${to}&hideTransfers=${hideTransfers}${accountIdsParam}`,
  );
  // Feeds the "Tagged views" virtual-rows section below the main
  // table. Category rows carry their tags[] column; we build a
  // categoryId → tags[] map once here and let buildVirtualRowsByTag
  // do the actual grouping. This endpoint is already cached by SWR
  // (Categories admin page uses the same key) so the fetch is
  // near-instant on repeat views.
  const { data: categoryRows = [], mutate: mutateCategoryRows } = useSwrJson<
    Array<{ id: string; name: string; parentId: string | null; tags: string[] | null }>
  >("/api/categories");
  const enabledTagIds = displayPrefs.cashflowEnabledTagIds;
  function toggleTag(tag: string) {
    const next = enabledTagIds.includes(tag)
      ? enabledTagIds.filter((t) => t !== tag)
      : [...enabledTagIds, tag];
    setPref("cashflowEnabledTagIds", next);
  }

  // Tag-related derived state — memoised. These MUST live above the
  // early returns below so the hook count is stable across render
  // passes (React error #310 fires if a first-pass `isLoading=true`
  // return skips the hooks and the second pass runs them). Cheap
  // even when categoryRows is `[]` on the loading tick.
  //
  // Union of every tag in use across all cats, for the popover's
  // autocomplete list. Case-preserving, deduped, alphabetical.
  const allTagsSuggestion = useMemo(() => {
    const set = new Set<string>();
    for (const c of categoryRows) for (const t of c.tags ?? []) if (t.trim()) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [categoryRows]);
  // Category path lookup — "Grandparent › Parent › Child" (same
  // format used by the import panel + transactions neighbours).
  // Used by VirtualTagRow to render its bulleted member list.
  const categoryPathById = useMemo(() => {
    const map = buildCategoryPathStringMap(
      categoryRows.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
    );
    const out: Record<string, string> = {};
    map.forEach((path, id) => { out[id] = path; });
    return out;
  }, [categoryRows]);
  // Pre-index tags by id so `tagsFor` is O(1) rather than an
  // Array.find per subscriber per render.
  const tagsByIdMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of categoryRows) m.set(c.id, c.tags ?? []);
    return m;
  }, [categoryRows]);
  // The context value itself is memoised. Without this, every
  // parent re-render (SWR revalidation, pref mutation) minted a
  // fresh object and every context subscriber re-rendered — the
  // popover's reset effect in particular treated that as "context
  // changed", clobbering the in-progress draft mid-typing.
  const tagCtxValue = useMemo(
    () => ({
      tagsFor: (catId: string) => tagsByIdMap.get(catId) ?? [],
      allTags: allTagsSuggestion,
      saveTags: async (catId: string, next: string[]): Promise<boolean> => {
        const res = await fetch(`/api/categories/${catId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tags: next.length > 0 ? next : null }),
        });
        if (!res.ok) {
          toast.error("Failed to save tags");
          return false;
        }
        toast.success("Tags updated");
        // Refresh /api/categories so the popover, virtual-rows section
        // and future openings all see the new tag set.
        await mutateCategoryRows();
        return true;
      },
    }),
    [tagsByIdMap, allTagsSuggestion, mutateCategoryRows],
  );

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Loading cashflow data…</p>;
  }
  if (!data || data.months.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No data for this period.</p>;
  }

  const { months, income, expenses, closingBalance } = data;
  const thisMonth = format(new Date(), "yyyy-MM");
  // Per-month columns disappear entirely when monthAxis is off
  // (Category tab). Only the row-end aggregates contribute then.
  const monthCols = monthAxis ? months.length : 0;
  const totalCols =
    1 + monthCols +
    (showCounts ? monthCols : 0) +
    // One per-month "Plan" sub-column when the toggle is on.
    (showPlan ? monthCols : 0) +
    // One per-month "Diff" sub-column when mode === "diff".
    (showDiff ? monthCols : 0) +
    // Total column is always rendered; +1 for it, +1 more if
    // Counts are on (the per-Total Counts mirror).
    1 + (showCounts ? 1 : 0) +
    (showAvg ? 1 : 0) +
    (showPlan ? 1 : 0) +
    (showDiff ? 1 : 0);

  // Hidden-category logic. A cat is hidden when it (or any ancestor)
  // is in the excluded set — hiding "Food" should drop "Food /
  // Groceries" and "Food / Restaurants" out of the rollup too.
  // Hidden cats are ALWAYS excluded from totals; the showHidden
  // toggle only controls whether they're rendered (greyed out, in
  // their own section) so the operator can find and un-hide them.
  const excludedSet = new Set(excludedIds);
  function catIsHidden(c: CashflowCategory): boolean {
    if (excludedSet.has(c.id)) return true;
    if (c.parentId && excludedSet.has(c.parentId)) return true;
    if (c.grandparentId && excludedSet.has(c.grandparentId)) return true;
    return false;
  }
  const visibleIncome = income.filter((c) => !catIsHidden(c));
  const visibleExpenses = expenses.filter((c) => !catIsHidden(c));
  const hiddenIncome = income.filter((c) => catIsHidden(c));
  const hiddenExpenses = expenses.filter((c) => catIsHidden(c));

  // Virtual "tagged views" rows. Built from ALL cats in-window (not
  // just visible) — a hidden category's contribution to a tag is
  // still relevant to the tag's total. Deliberately never fed into
  // `visibleIncome`/`visibleExpenses` or `totals` below, so these
  // rows can't affect Total Income / Total Expenses / Surplus.
  const tagsByCategoryId: Record<string, string[] | null> = {};
  for (const row of categoryRows) tagsByCategoryId[row.id] = row.tags ?? null;
  const allCatsInWindow = [...income, ...expenses];
  // Lookup so each virtual member sub-row can find its full
  // CashflowCategory (byMonth, total, etc.) — the member list in
  // `virtualRows` only carries ids.
  const catById = new Map<string, CashflowCategory>();
  for (const c of allCatsInWindow) catById.set(c.id, c);
  const virtualRows = buildVirtualRowsByTag(
    allCatsInWindow,
    tagsByCategoryId,
    months,
  );

  // Visible groups feed the primary income/expense sections. Hidden
  // groups (built from the hidden cats only) feed a separate section
  // rendered when showHidden is on — keeps the main tree's aggregates
  // free of hidden cats while still letting the operator see what's
  // been excluded.
  // Cashflow's `buildGroups` already aggregates the parent row's
  // total + plan from its descendants, so an explicit "rollup"
  // toggle is redundant — the parent line already shows the
  // family figure by default.
  const incomeGroups = buildGroups(visibleIncome);
  const expenseGroups = buildGroups(visibleExpenses);
  const hiddenIncomeGroups = buildGroups(hiddenIncome);
  const hiddenExpenseGroups = buildGroups(hiddenExpenses);

  // Recompute aggregate totals from visible cats so hidden cats don't
  // pollute Total Income / Total Expenses / Surplus.
  const totals = {
    income: aggregateField(visibleIncome, "byMonth"),
    expenses: aggregateField(visibleExpenses, "byMonth"),
    net: {} as Record<string, number>,
  };
  for (const m of months) {
    totals.net[m] = (totals.income[m] ?? 0) + (totals.expenses[m] ?? 0);
  }
  const hasHidden = hiddenIncome.length > 0 || hiddenExpenses.length > 0;

  const gpIds = [...incomeGroups, ...expenseGroups]
    .flatMap((g) => g.kind === "grandparent" ? [g.grandparentId] : []);
  const allCollapsed = gpIds.length > 0 && gpIds.every((id) => collapsedGps.has(id));

  function toggleCollapseAll() {
    if (allCollapsed) {
      setCollapsedGps(new Set());
      setCollapsedSubs(new Set());
    } else {
      setCollapsedGps(new Set(gpIds));
    }
  }

  const collapse: CollapseState = { collapsedGps, collapsedSubs, onToggleGp: toggleGp, onToggleSub: toggleSub };

  return (
    <CellOpenerContext.Provider value={setCellQuery}>
    <HideToggleContext.Provider value={{ isHidden: (id) => excludedSet.has(id), toggle: toggleHideCat }}>
    <TagContext.Provider value={tagCtxValue}>
    <ColOptsContext.Provider value={opts}>
    <div className="space-y-3 print-landscape">
      {/* Filter bar. Sticky against the app Topbar (h-14 = 56px) so
          the operator can toggle Plan / Counts / Avg without
          scrolling back up through a long category list. z-10 keeps
          it below the Topbar's own z-20; padding tightened + a
          bottom border give it the "sticky header strip" look. */}
      <div className="sticky top-14 z-10 -mx-4 lg:-mx-6 px-4 lg:px-6 py-2 bg-background border-b flex items-center justify-between gap-4 print:hidden print:static">
        {/* Collapse all / Expand all */}
        <button
          onClick={toggleCollapseAll}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
        >
          {allCollapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />}
          {allCollapsed ? "Expand all" : "Collapse all"}
        </button>

        <div className="flex items-center gap-4">
        {/* Totals level segmented control */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Subtotals</span>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["none", "parent", "grandparent"] as TotalsLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => changeTotalsLevel(level)}
                className={`px-2.5 py-1 transition-colors ${
                  totalsLevel === level
                    ? "bg-indigo-600 text-white font-medium"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
              >
                {level === "grandparent" ? "Full" : level === "parent" ? "Parent" : "Off"}
              </button>
            ))}
          </div>
        </div>

        {/* Show avg toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Avg/mo</span>
          <Switch checked={showAvg} onCheckedChange={toggleShowAvg} aria-label="Show monthly average column" />
        </div>

        {/* Plan three-way: Off | Plan | Diff. Plan shows the budget+
            scheduled overlay per month + the row-end plan total. Diff
            adds a per-month Diff cell (Total − Plan, signed by category
            type) and a Diff total cell after the row-end plan total.
            The Diff cells carry the computed-cell background so they
            read as derived columns, same convention as the Total. */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Plan</span>
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["off", "plan", "diff"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setPlanMode(mode)}
                className={`px-2.5 py-1 transition-colors ${
                  planMode === mode
                    ? "bg-indigo-600 text-white font-medium"
                    : "bg-background text-muted-foreground hover:bg-muted"
                }`}
                aria-label={`Plan mode: ${mode}`}
              >
                {mode === "off" ? "Off" : mode === "plan" ? "Plan" : "Diff"}
              </button>
            ))}
          </div>
        </div>

        {/* Show counts toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Show counts</span>
          <Switch checked={showCounts} onCheckedChange={toggleShowCounts} aria-label="Show transaction counts" />
        </div>

        {/* Hide transfers toggle — drops transfer-typed categories
            (transferKind in 'internal','external') from the underlying
            cashflow query. Default on; flip off to include transfers
            in the totals + rows. */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Hide transfers</span>
          <Switch
            checked={hideTransfers}
            onCheckedChange={(v) => setPref("cashflowHideTransfers", v)}
            aria-label="Hide transfer-typed categories"
          />
        </div>

        {/* Show hidden categories — only rendered when there's
            actually something hidden to reveal; otherwise the toggle
            would just sit there doing nothing. */}
        {hasHidden && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Show {excludedSet.size} hidden
            </span>
            <Switch
              checked={showHidden}
              onCheckedChange={toggleShowHidden}
              aria-label="Show hidden categories"
            />
          </div>
        )}

        </div>
      </div>
    {/* Inner scroll container so the table's `thead` can sticky to
        the wrapper's top instead of the (already-scrolled-off) page.
        Filters + controls above this stay visible because the page
        itself no longer needs to scroll the table out of view. */}
    {/* Skip the wrapper's top border so the only horizontal line on
        the header row is the inset shadow under each <th> — putting
        the split visually at the BOTTOM of the header cells instead
        of doubling up with a wrapper-border line at the top. */}
    {/* Scroll wrapper. Bounded max-height by viewport so:
          (a) the horizontal scrollbar at the bottom of this wrapper
              stays IN the viewport instead of sitting far below the
              fold on a long report;
          (b) the `sticky top-0` on the <thead> below anchors to
              this wrapper's top — which now sits right underneath
              the sticky filter bar — so column headers stay
              visible while the operator scrolls rows.
          `--cashflow-chrome` defaults to 180px (Topbar 56 + filter
          bar ~48 + ReportsView date-range ~40 + tabs ~36); exposed
          as a CSS variable so the value can be tuned without
          touching JS. Print media ignores the max-h bound so long
          reports paginate naturally. */}
    <div
      className={`relative rounded-lg border overflow-auto overscroll-contain print:overflow-visible print:max-h-none max-h-[calc(100dvh-var(--cashflow-chrome,180px))] ${
        monthAxis ? "" : "max-w-3xl mx-auto"
      }`}
      style={{ scrollbarGutter: "stable" }}
    >
      {/* `w-max` (not `w-full`) so the table takes its natural
          content-driven width. When Plan + Counts are OFF the total
          fixed-column width drops below the viewport and `w-full`
          used to dump the slack into the auto-width Category
          column — reading as "everything jams right" because the
          gap between the category text and the first month value
          widened. With `w-max` the table left-aligns in the scroller
          at its natural size; any leftover space is on the right
          of the wrapper, not between the label and the numbers. */}
      <table className="w-max text-sm border-collapse">
        <thead>
          <tr className="bg-muted">
            {/* Double-sticky corner — z-30 so it stacks above the
                other `sticky top-0` <th>s (z-10) AND above the
                filter bar (z-10) when the operator scrolls both
                axes at once. */}
            <th className="text-left px-3 py-2 font-semibold sticky top-0 left-0 bg-muted min-w-44 z-30 shadow-[inset_0_-1px_0_0_var(--border)]">
              Category
            </th>
            {monthAxis &&
              months.map((m) => (
                <Fragment key={m}>
                  {showPlan && (
                    <th className={`text-right px-2 py-2 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap border-l border-border sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] ${m === thisMonth ? "bg-indigo-500/10 print:bg-transparent" : "bg-muted"}`}>
                      Plan
                    </th>
                  )}
                  <th
                    className={`text-right px-3 py-2 font-semibold whitespace-nowrap w-[80px] sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] ${!showPlan ? "border-l border-border" : ""} ${
                      m === thisMonth ? "bg-indigo-500/15 print:bg-transparent text-indigo-600 dark:text-indigo-400" : "bg-muted"
                    }`}
                  >
                    {format(parseISO(`${m}-01`), "MMM ''yy")}
                  </th>
                  {showDiff && (
                    <th className={`text-right px-2 py-2 font-medium text-[10px] text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap border-l border-border sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] ${m === thisMonth ? "bg-indigo-500/10 print:bg-transparent" : "bg-muted"}`}>
                      Diff
                    </th>
                  )}
                  {showCounts && (
                    <th className={`text-right px-2 py-2 font-medium text-[11px] text-muted-foreground whitespace-nowrap w-[40px] sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] ${m === thisMonth ? "bg-indigo-500/10 print:bg-transparent" : "bg-muted"}`}>
                      #
                    </th>
                  )}
                </Fragment>
              ))}
            <th className="text-right px-3 py-2 font-semibold whitespace-nowrap w-[80px] bg-muted sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] border-l border-border">
              Total
            </th>
            {showCounts && (
              <th className="text-right px-2 py-2 font-medium text-[11px] text-muted-foreground whitespace-nowrap w-[40px] bg-muted sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] border-l border-border">#</th>
            )}
            {showAvg && (
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap w-[80px] text-muted-foreground bg-muted sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] border-l border-border">
                Avg/mo
              </th>
            )}
            {showPlan && (
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap w-[80px] text-muted-foreground/70 bg-muted sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] border-l border-border">
                Plan
              </th>
            )}
            {showDiff && (
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap w-[80px] bg-muted sticky top-0 z-10 shadow-[inset_0_-1px_0_0_var(--border)] border-l border-border">
                Diff
              </th>
            )}
          </tr>
        </thead>

        <tbody>
          {/* ── SUMMARY ── */}
          <SectionHeader label="Summary" cols={totalCols} />
          <TotalsRow label="Closing Balance" months={months} values={closingBalance} thisMonth={thisMonth} mode="balance" />
          <TotalsRow label="Surplus / Deficit" months={months} values={totals.net} thisMonth={thisMonth} mode="net" />

          {/* ── INCOME ── */}
          <SectionHeader label="Income Categories" cols={totalCols} />
          {incomeGroups.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="px-3 py-3 text-muted-foreground text-xs">
                No income transactions in this period.
              </td>
            </tr>
          )}
          {renderGroups(incomeGroups, months, thisMonth, false, from, to, totalsLevel, collapse, () => false)}
          <TotalsRow label="Total Income" months={months} values={totals.income} thisMonth={thisMonth} mode="net" />

          {/* ── EXPENSES ── */}
          <SectionHeader label="Expense Categories" cols={totalCols} />
          {expenseGroups.length === 0 && (
            <tr>
              <td colSpan={totalCols} className="px-3 py-3 text-muted-foreground text-xs">
                No expense transactions in this period.
              </td>
            </tr>
          )}
          {renderGroups(expenseGroups, months, thisMonth, true, from, to, totalsLevel, collapse, () => false)}
          <TotalsRow label="Total Expenses" months={months} values={totals.expenses} thisMonth={thisMonth} negate />

          {/* ── TAGGED VIEWS ── virtual rows built from category tags
              (see src/lib/reports/virtual-rows.ts). One row per unique
              tag with at least one member category active in the
              window. Deliberately below Total Expenses and NEVER
              added to the totals math above — this is a parallel
              view, not additional data. Each row has an eye toggle
              persisted in `cashflowEnabledTagIds`; off state renders
              greyed so operators can see the tag exists and activate
              it. */}
          {virtualRows.length > 0 && (
            <>
              <SectionHeader label="Tagged views (excluded from totals)" cols={totalCols} />
              {virtualRows.map((row) => (
                <VirtualTagRow
                  key={row.tag}
                  row={row}
                  months={months}
                  thisMonth={thisMonth}
                  isEnabled={enabledTagIds.includes(row.tag)}
                  onToggle={() => toggleTag(row.tag)}
                  categoryPathById={categoryPathById}
                  catById={catById}
                  from={from}
                  to={to}
                />
              ))}
            </>
          )}

          {/* ── HIDDEN CATEGORIES ── only when the operator has flipped
              showHidden on AND there's at least one hidden cat with
              activity in the window. Rendered greyed-out, excluded
              from every total above. */}
          {showHidden && hasHidden && (
            <>
              <SectionHeader
                label="Hidden Categories (excluded from totals)"
                cols={totalCols}
              />
              {renderGroups(hiddenIncomeGroups, months, thisMonth, false, from, to, totalsLevel, collapse, () => true)}
              {renderGroups(hiddenExpenseGroups, months, thisMonth, true, from, to, totalsLevel, collapse, () => true)}
            </>
          )}
        </tbody>
      </table>
    </div>
    <CashflowCellDialog
      query={cellQuery}
      accountIds={accountIds}
      hideTransfers={hideTransfers}
      onClose={() => setCellQuery(null)}
    />
    </div>
    </ColOptsContext.Provider>
    </TagContext.Provider>
    </HideToggleContext.Provider>
    </CellOpenerContext.Provider>
  );
}
