"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn, formatAUD } from "@/lib/utils";
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil, GripVertical } from "lucide-react";
import type { Category, TaxConfig } from "@/db/schema";
import { buildCategoryMeta } from "@/lib/category-path";
import { classifyCategoryDefault } from "@/lib/tax/calc";

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
  "#94a3b8", "#64748b", "#475569",
];

type FormState = {
  name: string;
  type: "income" | "expense";
  color: string;
  parentId: string;
};

const EMPTY_FORM: FormState = { name: "", type: "expense", color: COLORS[0], parentId: "" };

// Drop targets: a category id (= nest the dragged row under it) or one
// of the two section roots (= move to the top level of that section).
// We previously also supported `before:` / `after:` for sibling reorder
// but that drag mode was unreliable on Safari (stuck-drag state, missing
// dragend events) so it was reverted; categories sort by their backfilled
// sortOrder which mirrors the original alphabetical order.
type DropTarget = string | "income-root" | "expense-root";

export function CategoryManager({
  initialCategories,
  txCounts = {},
  txAmounts = {},
  taxConfig,
}: {
  initialCategories: Category[];
  txCounts?: Record<string, number>;
  /** Signed sum of `transactions.amount` per category — refunds reduce the
   * magnitude. Display as `Math.abs(...)`. */
  txAmounts?: Record<string, number>;
  /** Per-category tax-deduction rules (work-use %, WFH bundle membership)
   * loaded from app_settings.tax_config. Edits PATCH back via /api/settings. */
  taxConfig?: TaxConfig;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [, startTransition] = useTransition();
  const [cats, setCats] = useState<Category[]>(initialCategories);
  const [form, setForm] = useState<FormState | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Local tax-rule state so edits feel instant; mirror PATCH back to the
  // server (deep-merged) and refresh the route to pick up any other changes.
  const [taxRules, setTaxRules] = useState<TaxConfig["categoryRules"]>(
    taxConfig?.categoryRules ?? {},
  );

  async function saveTaxRule(
    categoryId: string,
    update: Partial<{ workUsePct: number; bundledInWfh: boolean }>,
  ) {
    const cur = taxRules[categoryId] ?? { workUsePct: 0, bundledInWfh: false };
    const next = { ...cur, ...update };
    setTaxRules((prev) => ({ ...prev, [categoryId]: next }));
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxConfig: { categoryRules: { [categoryId]: next } },
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (err) {
      toast.error(`Could not save tax rule: ${err instanceof Error ? err.message : "Unknown"}`);
      setTaxRules((prev) => ({ ...prev, [categoryId]: cur }));
    }
  }

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget | null>(null);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming?.id]);


  const parents = cats.filter((c) => !c.parentId);
  const childrenOf = (parentId: string) => cats.filter((c) => c.parentId === parentId);
  const { meta: catMeta } = buildCategoryMeta(cats);

  // ── Drag helpers ──────────────────────────────────────────────────────────


  function getSubtreeDepth(id: string): number {
    const kids = cats.filter((c) => c.parentId === id);
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map((k) => getSubtreeDepth(k.id)));
  }

  function isDescendantOf(candidateId: string, ancestorId: string): boolean {
    let cur = cats.find((c) => c.id === candidateId);
    while (cur?.parentId) {
      if (cur.parentId === ancestorId) return true;
      cur = cats.find((c) => c.id === cur!.parentId);
    }
    return false;
  }

  function isValidDrop(draggedId: string, target: DropTarget): boolean {
    const dragged = cats.find((c) => c.id === draggedId);
    if (!dragged) return false;

    if (target === "income-root" || target === "expense-root") {
      const targetType = target === "income-root" ? "income" : "expense";
      return dragged.type === targetType;
    }

    if (draggedId === target) return false;
    if (isDescendantOf(target, draggedId)) return false;

    const targetCat = cats.find((c) => c.id === target);
    if (!targetCat) return false;
    if (targetCat.type !== dragged.type) return false;

    const targetDepth = catMeta.get(target)?.depth ?? 0;
    const draggedSubtree = getSubtreeDepth(draggedId);
    return targetDepth + 1 + draggedSubtree <= 2;
  }

  async function handleDropOnTarget(draggedId: string, target: DropTarget) {
    const dragged = cats.find((c) => c.id === draggedId);
    if (!dragged || !isValidDrop(draggedId, target)) return;

    const newParentId =
      target === "income-root" || target === "expense-root" ? null : target;

    if (dragged.parentId === newParentId) return;

    const res = await fetch(`/api/categories/${draggedId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: newParentId }),
    });

    if (!res.ok) {
      toast.error("Failed to move category");
      return;
    }
    const updated: Category = await res.json();
    setCats((prev) => prev.map((c) => (c.id === draggedId ? updated : c)));
    startTransition(() => router.refresh());
    toast.success(`Moved "${dragged.name}"`);
  }

  function dragOverHandlers(target: DropTarget) {
    return {
      onDragOver(e: React.DragEvent) {
        e.preventDefault();
        if (!dragId) return;
        const valid = isValidDrop(dragId, target);
        e.dataTransfer.dropEffect = valid ? "move" : "none";
        setDragOverTarget(valid ? target : null);
      },
      onDragLeave() {
        setDragOverTarget((prev) => (prev === target ? null : prev));
      },
      onDrop(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (dragId) handleDropOnTarget(dragId, target);
        setDragId(null);
        setDragOverTarget(null);
      },
    };
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;

    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        type: form.type,
        color: form.color,
        parentId: form.parentId || null,
      }),
    });

    if (!res.ok) {
      toast.error("Failed to create category");
      return;
    }
    const created: Category = await res.json();
    setCats((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    setForm(null);
    startTransition(() => router.refresh());
    toast.success(`Category "${created.name}" created`);
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirm({
      title: "Delete category",
      description: `Delete "${name}"? Any transactions using it will become uncategorised.`,
      confirmLabel: "Delete",
    });
    if (!ok) return;

    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
      toast.error(error);
      return;
    }
    setCats((prev) =>
      prev.map((c) => (c.parentId === id ? { ...c, parentId: null } : c)).filter((c) => c.id !== id)
    );
    startTransition(() => router.refresh());
    toast.success(`Deleted "${name}"`);
  }

  async function handleRename(id: string, newName: string) {
    const trimmed = newName.trim();
    const original = cats.find((c) => c.id === id)?.name ?? "";
    setRenaming(null);
    if (!trimmed || trimmed === original) return;

    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    });

    if (!res.ok) {
      toast.error("Failed to rename category");
      return;
    }
    const updated: Category = await res.json();
    setCats((prev) => prev.map((c) => (c.id === id ? updated : c)));
    startTransition(() => router.refresh());
    toast.success(`Renamed to "${updated.name}"`);
  }

  async function handleSetTransferKind(
    id: string,
    transferKind: "none" | "internal" | "external",
  ) {
    const res = await fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transferKind }),
    });
    if (!res.ok) { toast.error("Failed to update category"); return; }
    const updated: Category = await res.json();
    setCats((prev) => prev.map((c) => (c.id === id ? updated : c)));
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const income = parents.filter((c) => c.type === "income");
  const expense = parents.filter((c) => c.type === "expense");

  // ── Render ────────────────────────────────────────────────────────────────

  function renderCategory(cat: Category, depth = 0) {
    const children = childrenOf(cat.id);
    const isCollapsed = collapsed.has(cat.id);
    const isRenaming = renaming?.id === cat.id;
    const isDragging = dragId === cat.id;
    const isDropTarget = dragOverTarget === cat.id;
    const canDrop = dragId ? isValidDrop(dragId, cat.id) : false;
    const subtreeCount = txCounts[cat.id] ?? 0;
    const signedAmount = txAmounts[cat.id] ?? 0;
    const displayAmount = Math.abs(signedAmount);
    // Resolve per-category tax rule: explicit user setting wins; otherwise
    // fall back to the pattern-based auto-classification so the user sees the
    // sensible default (e.g. Internet/* auto-bundled in WFH).
    const path = catMeta.get(cat.id)?.path ?? [cat.name];
    const auto = classifyCategoryDefault(path);
    const taxRule = taxRules[cat.id];
    const workUsePct = taxRule?.workUsePct ?? auto.defaultPct;
    const bundledInWfh = taxRule?.bundledInWfh ?? auto.bundledInWfh;
    const hasTaxOverride = !!taxRule;

    return (
      <div key={cat.id}>
        <div
          draggable
          onDragStart={(e) => {
            setDragId(cat.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", cat.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDragOverTarget(null);
          }}
          {...(canDrop || isDropTarget ? dragOverHandlers(cat.id) : {
            onDragOver(e: React.DragEvent) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "none";
            },
            onDrop(e: React.DragEvent) { e.preventDefault(); },
          })}
          // Inline-style the grid because Safari kept dropping
          // `grid-template-columns` from Tailwind's arbitrary value AND
          // from a named CSS class. Inline style is the only delivery
          // channel that survives whatever Safari is doing to multi-
          // track templates with `minmax()`.
          style={{
            display: "grid",
            gridTemplateColumns:
              "16px minmax(0, 1fr) 3rem 5rem 4rem 3.5rem 2.5rem 5rem",
            alignItems: "center",
            columnGap: "0.5rem",
          }}
          className={cn(
            "py-1.5 px-2 rounded-md group transition-colors",
            isDragging && "opacity-40",
            isDropTarget
              ? "bg-indigo-500/10 ring-1 ring-inset ring-indigo-400/50"
              : "hover:bg-muted/50",
            dragId && !isDragging && !canDrop && "cursor-not-allowed",
          )}
        >
          {/* Col 1: drag handle. Cosmetic only — the row itself is
              `draggable`, so any non-button area in the row initiates
              the drag. */}
          <span
            className="flex items-center justify-center text-muted-foreground/60 cursor-grab active:cursor-grabbing shrink-0"
            title="Drag to move (or drop another row onto this one to nest)"
          >
            <GripVertical className="h-4 w-4" />
          </span>

          {/* Col 2: indent + chevron + dot + name (link). Indent applied
              inside the cell so the right-side columns stay aligned. */}
          {/* Indent via inline padding so the depth scale doesn't depend
              on Tailwind ml-1/ml-6 classes (which Safari sometimes drops
              from compiled chunks the same way it drops grid templates).
              Depth 1 gets ~24px of inset, depth 2 gets ~48px — both
              reach the chevron/dot/name through a vertical guide line. */}
          <div
            className="flex items-center gap-2 min-w-0"
            style={
              depth >= 1
                ? {
                    marginLeft: depth === 1 ? "0.25rem" : `${0.25 + 1.25 * (depth - 1)}rem`,
                    paddingLeft: "1.25rem",
                    borderLeft: "1px solid var(--border)",
                  }
                : undefined
            }
          >
            {children.length > 0 ? (
              <button
                onClick={(e) => { e.stopPropagation(); toggleCollapse(cat.id); }}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                {isCollapsed
                  ? <ChevronRight className="h-3 w-3" />
                  : <ChevronDown className="h-3 w-3" />}
              </button>
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: cat.color }}
            />
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="text-sm flex-1 min-w-0 border-b border-indigo-400 bg-transparent outline-none px-0.5"
                value={renaming.value}
                onChange={(e) => setRenaming({ id: cat.id, value: e.target.value })}
                onBlur={() => handleRename(cat.id, renaming.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(cat.id, renaming.value);
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : subtreeCount > 0 ? (
              <Link
                href={`/transactions?categoryId=${cat.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-sm flex-1 min-w-0 truncate hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                title={`Open transactions filtered to ${cat.name}`}
              >
                {cat.name}
              </Link>
            ) : (
              <span className="text-sm flex-1 min-w-0 truncate">
                {cat.name}
              </span>
            )}
          </div>

          {/* Col 3: count (read-only value, never a link). */}
          <span
            className={cn(
              "text-[10px] tabular-nums text-right",
              subtreeCount === 0 ? "text-muted-foreground/30" : "text-muted-foreground",
            )}
            title={`${subtreeCount} transaction${subtreeCount !== 1 ? "s" : ""}`}
          >
            {subtreeCount}
          </span>

          {/* Col 4: |sum(amount)|. Refunds reduce the displayed magnitude. */}
          <span
            className={cn(
              "text-[10px] tabular-nums whitespace-nowrap text-right",
              displayAmount === 0 ? "text-muted-foreground/30" : "text-muted-foreground",
            )}
            title={signedAmount < 0 ? "Outflow total (all-time)" : "Inflow total (all-time)"}
          >
            {displayAmount > 0 ? formatAUD(displayAmount).replace("A$", "$") : "—"}
          </span>

          {/* Col 5: transfer-kind cycle button. Click cycles
              none → internal → external → none. Mutual exclusion is
              automatic; one glyph per row makes the state legible at a glance. */}
          <div className="flex items-center justify-end gap-1">
            {(() => {
              const next: Record<"none" | "internal" | "external", "none" | "internal" | "external"> = {
                none: "internal",
                internal: "external",
                external: "none",
              };
              const kind = cat.transferKind;
              const glyph = kind === "internal" ? "⇅" : kind === "external" ? "$" : "—";
              const title =
                kind === "internal"
                  ? "Inner transfer — money between your accounts; excluded from cashflow. Click to make this an External payment."
                  : kind === "external"
                    ? "External payment — to an untracked debt; counted as an expense. Click to clear."
                    : "Regular category — click to mark as Inner transfer (between your accounts).";
              const styles =
                kind === "internal"
                  ? "bg-amber-500/15 text-amber-600"
                  : kind === "external"
                    ? "bg-sky-500/15 text-sky-600"
                    : "bg-muted/50 text-muted-foreground/40 hover:bg-amber-500/15 hover:text-amber-600";
              return (
                <button
                  onClick={(e) => { e.stopPropagation(); handleSetTransferKind(cat.id, next[kind]); }}
                  title={title}
                  className={cn(
                    "shrink-0 text-[10px] px-1.5 py-0.5 rounded-full transition-colors min-w-[20px]",
                    styles,
                  )}
                >
                  {glyph}
                </button>
              );
            })()}
          </div>

          {/* Col 6: Work-use % input. Income rows render an empty placeholder
              so the WFH column to its right stays aligned. */}
          {cat.type === "expense" ? (
            <div className="flex items-center justify-end gap-1">
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                defaultValue={workUsePct}
                key={`pct-${cat.id}-${workUsePct}`}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const n = parseFloat(e.target.value);
                  if (Number.isNaN(n) || n === workUsePct) return;
                  saveTaxRule(cat.id, { workUsePct: Math.max(0, Math.min(100, n)) });
                }}
                className={cn(
                  "w-10 text-[11px] tabular-nums text-right border rounded px-1 py-0.5 bg-background",
                  hasTaxOverride ? "border-indigo-400/60" : "border-border/50 text-muted-foreground",
                )}
                title="Work-use % claimable for this category"
              />
              <span className="text-[10px] text-muted-foreground/70">%</span>
            </div>
          ) : (
            <span />
          )}

          {/* Col 7: WFH bundle toggle (expense rows only). */}
          {cat.type === "expense" ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); saveTaxRule(cat.id, { bundledInWfh: !bundledInWfh }); }}
              title={bundledInWfh
                ? "Bundled in WFH fixed-rate (covers utilities/internet/phone) — click to unmark"
                : "Mark as bundled in WFH fixed-rate"}
              className={cn(
                "justify-self-center shrink-0 text-[10px] px-1.5 py-0.5 rounded-full transition-colors",
                bundledInWfh
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-muted text-muted-foreground hover:bg-emerald-500/15 hover:text-emerald-600",
              )}
            >
              WFH
            </button>
          ) : (
            <span />
          )}

          {/* Col 8: rename / add / delete actions, always visible. */}
          <div className="flex items-center justify-end gap-1 text-muted-foreground/60">
            <button
              onClick={() => setRenaming({ id: cat.id, value: cat.name })}
              className="hover:text-foreground px-1"
              title="Rename"
            >
              <Pencil className="h-3 w-3" />
            </button>
            {depth < 2 ? (
              <button
                onClick={() => setForm({ ...EMPTY_FORM, type: cat.type as "income" | "expense", parentId: cat.id })}
                className="hover:text-foreground px-1"
                title="Add subcategory"
              >
                <Plus className="h-3 w-3" />
              </button>
            ) : (
              // Keep the column width stable when the depth-2 row hides the
              // Add button — empty placeholder matches the icon's footprint.
              <span className="px-1 w-3" />
            )}
            <button
              onClick={() => handleDelete(cat.id, cat.name)}
              className="hover:text-red-500 px-1"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {!isCollapsed && children.map((child) => renderCategory(child, depth + 1))}
      </div>
    );
  }

  function SectionDropZone({ target, label }: { target: "income-root" | "expense-root"; label: string }) {
    const isOver = dragOverTarget === target;
    const canDrop = dragId ? isValidDrop(dragId, target) : false;
    return (
      <div
        {...dragOverHandlers(target)}
        className={cn(
          "text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-1 py-1 rounded transition-colors",
          isOver && canDrop && "bg-indigo-500/10 text-indigo-600 ring-1 ring-inset ring-indigo-400/50",
        )}
      >
        {label}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-medium">Categories</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setForm(form ? null : { ...EMPTY_FORM })}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Category
        </Button>
      </div>

      {/* Create form */}
      {form && (
        <form onSubmit={handleCreate} className="px-4 py-3 bg-muted/40 border-b space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Name *</Label>
              <Input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((f) => f && { ...f, name: e.target.value })}
                placeholder="e.g. Insurance"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Type *</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => f && { ...f, type: v as "income" | "expense" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Parent (optional)</Label>
              <Select
                value={form.parentId}
                onValueChange={(v) => setForm((f) => f && { ...f, parentId: v ?? "" })}
              >
                <SelectTrigger>
                  <SelectValue>
                    {form.parentId
                      ? (catMeta.get(form.parentId)?.path.join(" / ") ?? "Top-level")
                      : "Top-level"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Top-level</SelectItem>
                  {parents
                    .filter((p) => p.type === form.type)
                    .map((p) => {
                      const depth1 = childrenOf(p.id);
                      if (depth1.length === 0) {
                        return <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>;
                      }
                      return (
                        <SelectGroup key={p.id}>
                          <SelectItem value={p.id}>{p.name}</SelectItem>
                          {depth1.map((child) => (
                            <SelectItem key={child.id} value={child.id} className="pl-5">
                              {p.name} / {child.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Colour</Label>
              <div className="flex gap-1.5 flex-wrap pt-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => f && { ...f, color: c })}
                    className={cn(
                      "w-5 h-5 rounded-full border-2 transition-transform",
                      form.color === c ? "border-slate-800 scale-110" : "border-transparent"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!form.name}>
              {form.parentId
                ? `Add subcategory under ${cats.find((c) => c.id === form.parentId)?.name ?? "parent"}`
                : "Add category"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      <div className="p-4 space-y-5">
        {/* Legend — explains every glyph on a row so the icons aren't
            cryptic. The same colour treatment as the row controls so
            users connect "amber ↕" / "sky $" / "emerald WFH" at a glance. */}
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
          <p className="font-medium text-foreground/80 mb-1.5">Row legend</p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            <li className="flex items-center gap-2">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span>Drag to reorder, or onto another row to nest under it</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="underline text-indigo-600 dark:text-indigo-400">Name</span>
              <span>— click to open the filtered transactions list</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums">12</span>
              <span>— transaction count for the subtree (read-only)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums">$1,234</span>
              <span>— |sum of amounts| over the subtree (refunds reduce)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600">⇅</span>
              <span>Inner transfer — money moves between your own accounts; excluded from cashflow</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-600">$</span>
              <span>External payment — to an untracked debt (e.g. external loan / CC); counted as expense</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[10px] tabular-nums border border-border/50 rounded px-1">25</span>
              <span className="text-[10px] text-muted-foreground/70">%</span>
              <span>— work-use % claimable in the tax report</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">WFH</span>
              <span>Bundled in the WFH fixed-rate hourly claim</span>
            </li>
            <li className="flex items-center gap-2">
              <Pencil className="h-3 w-3" />
              <Plus className="h-3 w-3" />
              <Trash2 className="h-3 w-3" />
              <span>— rename · add subcategory · delete</span>
            </li>
          </ul>
        </div>

        <div>
          <SectionDropZone target="income-root" label="Income" />
          {income.length === 0 && (
            <p className="text-xs text-muted-foreground pl-2">No income categories yet.</p>
          )}
          {income.map((c) => renderCategory(c))}
        </div>

        <div>
          <SectionDropZone target="expense-root" label="Expenses" />
          {expense.length === 0 && (
            <p className="text-xs text-muted-foreground pl-2">No expense categories yet.</p>
          )}
          {expense.map((c) => renderCategory(c))}
        </div>
      </div>
    </div>
  );
}
