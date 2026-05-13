"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn, formatAUD } from "@/lib/utils";
import { Plus, Trash2, ChevronDown, ChevronRight, Pencil, GripVertical } from "lucide-react";
import type { Category, TaxConfig } from "@/db/schema";
import { buildCategoryMeta } from "@/lib/category-path";
import { CategoryDropdown } from "@/components/categories/category-dropdown";
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
  /** Category id currently open in the edit dialog (null = closed).
   * One source of truth so closing the dialog drops the state cleanly. */
  const [editingId, setEditingId] = useState<string | null>(null);

  // Local tax-rule state — mirrors what's been saved to the server so the
  // edit dialog can read the current rule and surface auto-classification
  // defaults when no explicit override exists.
  const [taxRules, setTaxRules] = useState<TaxConfig["categoryRules"]>(
    taxConfig?.categoryRules ?? {},
  );

  // Drag state
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<DropTarget | null>(null);

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
    if (!ok) return false;

    const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
      toast.error(error);
      return false;
    }
    setCats((prev) =>
      prev.map((c) => (c.parentId === id ? { ...c, parentId: null } : c)).filter((c) => c.id !== id)
    );
    startTransition(() => router.refresh());
    toast.success(`Deleted "${name}"`);
    return true;
  }

  /** Save edits collected by the dialog. Splits the category-shape fields
   * (PATCH /api/categories/[id]) from the tax-rule fields (PATCH
   * /api/settings, deep-merged) and runs them in parallel so the dialog
   * closes promptly. Returns true on success so the dialog can dismiss. */
  async function handleEditSave(
    id: string,
    catPatch: Partial<{ name: string; color: string; parentId: string | null; transferKind: "none" | "internal" | "external" }>,
    taxPatch: { workUsePct: number; bundledInWfh: boolean } | null,
  ): Promise<boolean> {
    const requests: Promise<Response>[] = [];
    if (Object.keys(catPatch).length > 0) {
      requests.push(
        fetch(`/api/categories/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(catPatch),
        }),
      );
    }
    if (taxPatch) {
      requests.push(
        fetch("/api/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taxConfig: { categoryRules: { [id]: taxPatch } } }),
        }),
      );
    }
    if (requests.length === 0) return true;

    const results = await Promise.all(requests);
    if (results.some((r) => !r.ok)) {
      toast.error("Failed to save category");
      return false;
    }

    if (Object.keys(catPatch).length > 0) {
      const updated: Category = await results[0].json();
      setCats((prev) => prev.map((c) => (c.id === id ? updated : c)));
    }
    if (taxPatch) {
      setTaxRules((prev) => ({ ...prev, [id]: taxPatch }));
    }
    startTransition(() => router.refresh());
    toast.success("Saved");
    return true;
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
    const isDragging = dragId === cat.id;
    const isDropTarget = dragOverTarget === cat.id;
    const canDrop = dragId ? isValidDrop(dragId, cat.id) : false;
    const subtreeCount = txCounts[cat.id] ?? 0;
    const signedAmount = txAmounts[cat.id] ?? 0;
    const displayAmount = Math.abs(signedAmount);

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
          // `grid-template-columns` from Tailwind's arbitrary value (and
          // from named CSS classes too — observed pre-refactor). Inline
          // style is the only delivery channel that survives whatever
          // Safari is doing to multi-track templates with `minmax()`.
          style={{
            display: "grid",
            gridTemplateColumns: "16px minmax(0, 1fr) 3rem 5rem 2rem",
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

          {/* Col 2: indent + chevron + dot + name (link). */}
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
              title={
                cat.transferKind === "internal"
                  ? "Inner transfer category"
                  : cat.transferKind === "external"
                    ? "External payment category"
                    : undefined
              }
            />
            {subtreeCount > 0 ? (
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
            {/* Tiny kind chip beside the name — keeps the row scannable
                without resurrecting a full column. Suppressed for the
                default ("none") so 99% of rows stay quiet. */}
            {cat.transferKind === "internal" && (
              <span
                className="shrink-0 text-[9px] px-1 py-0 rounded bg-amber-500/15 text-amber-600"
                title="Inner transfer — excluded from cashflow"
              >
                ⇅
              </span>
            )}
            {cat.transferKind === "external" && (
              <span
                className="shrink-0 text-[9px] px-1 py-0 rounded bg-sky-500/15 text-sky-600"
                title="External payment — counted as expense"
              >
                $
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

          {/* Col 5: single Edit button. Opens the dialog with everything
              else (rename, parent, colour, transfer kind, tax rules,
              delete) laid out with proper labels. */}
          <button
            onClick={(e) => { e.stopPropagation(); setEditingId(cat.id); }}
            className="text-muted-foreground/60 hover:text-foreground px-1 justify-self-end"
            title="Edit category"
            aria-label={`Edit ${cat.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
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
              <CategoryDropdown
                value={form.parentId || null}
                onChange={(v) => setForm((f) => f && { ...f, parentId: v ?? "" })}
                categories={cats}
                typeFilter={form.type === "income" ? "income" : "expense"}
                maxDepth={1}
                uncategorisedLabel="Top-level"
                triggerClassName="h-9 text-sm px-3 gap-1 text-foreground hover:bg-muted bg-background border rounded-md inline-flex items-center justify-between min-w-0 w-full disabled:opacity-50"
                popoverClassName="w-[var(--anchor-width)] p-0 gap-0 overflow-hidden min-w-72"
              />
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

      {editingId && (() => {
        const editingCat = cats.find((c) => c.id === editingId);
        if (!editingCat) return null;
        return (
          <CategoryEditDialog
            // Re-mount when the editing target changes so local field state
            // re-initialises from the new category cleanly. Without the key,
            // switching from row A to row B would keep A's draft state.
            key={editingCat.id}
            cat={editingCat}
            cats={cats}
            taxRule={taxRules[editingCat.id]}
            catMeta={catMeta}
            childrenOf={childrenOf}
            parents={parents}
            isDescendantOf={isDescendantOf}
            onSave={(catPatch, taxPatch) =>
              handleEditSave(editingCat.id, catPatch, taxPatch)
            }
            onDelete={async () => {
              const ok = await handleDelete(editingCat.id, editingCat.name);
              if (ok) setEditingId(null);
            }}
            onClose={() => setEditingId(null)}
          />
        );
      })()}
    </div>
  );
}

// ── Edit dialog ─────────────────────────────────────────────────────────────

/** Single-category edit dialog. Collects all editable fields in one panel
 * — name, colour, parent, transfer kind, tax rule (work-use %, WFH bundle
 * for expense categories) — and the destructive Delete action. Save runs
 * two parallel PATCHes (category + tax-config) and closes on success. */
function CategoryEditDialog({
  cat,
  cats,
  taxRule,
  catMeta,
  childrenOf,
  parents,
  isDescendantOf,
  onSave,
  onDelete,
  onClose,
}: {
  cat: Category;
  cats: Category[];
  taxRule: { workUsePct: number; bundledInWfh: boolean } | undefined;
  catMeta: ReturnType<typeof buildCategoryMeta>["meta"];
  childrenOf: (id: string) => Category[];
  parents: Category[];
  isDescendantOf: (candidateId: string, ancestorId: string) => boolean;
  onSave: (
    catPatch: Partial<{
      name: string;
      color: string;
      parentId: string | null;
      transferKind: "none" | "internal" | "external";
    }>,
    taxPatch: { workUsePct: number; bundledInWfh: boolean } | null,
  ) => Promise<boolean>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const path = catMeta.get(cat.id)?.path ?? [cat.name];
  const auto = classifyCategoryDefault(path);
  const initialWorkUsePct = taxRule?.workUsePct ?? auto.defaultPct;
  const initialBundledInWfh = taxRule?.bundledInWfh ?? auto.bundledInWfh;

  const [name, setName] = useState(cat.name);
  const [color, setColor] = useState(cat.color);
  const [parentId, setParentId] = useState(cat.parentId ?? "");
  const [transferKind, setTransferKind] = useState<"none" | "internal" | "external">(cat.transferKind);
  const [workUsePct, setWorkUsePct] = useState<number>(initialWorkUsePct);
  const [bundledInWfh, setBundledInWfh] = useState<boolean>(initialBundledInWfh);
  const [saving, setSaving] = useState(false);

  const isExpense = cat.type === "expense";

  // Valid-parent filter: same type, not the category itself, not a
  // descendant (cycle-prevention). The depth check matches the drag-drop
  // validator: target depth + dragged subtree depth must stay ≤ 2.
  function descendantDepth(id: string): number {
    const kids = cats.filter((c) => c.parentId === id);
    if (kids.length === 0) return 0;
    return 1 + Math.max(...kids.map((k) => descendantDepth(k.id)));
  }
  const myDepth = descendantDepth(cat.id);
  // The CategoryDropdown enforces the same-type, exclude-self,
  // exclude-descendants and max-depth rules via its
  // typeFilter / excludeIds / maxDepth props. No standalone helper
  // needed; everything that consumed `parentOptions` / `isValidParent`
  // is now in the dropdown.

  async function handleSave() {
    setSaving(true);
    const catPatch: Parameters<typeof onSave>[0] = {};
    if (name.trim() && name.trim() !== cat.name) catPatch.name = name.trim();
    if (color !== cat.color) catPatch.color = color;
    if ((parentId || null) !== (cat.parentId ?? null)) {
      catPatch.parentId = parentId || null;
    }
    if (transferKind !== cat.transferKind) catPatch.transferKind = transferKind;

    let taxPatch: Parameters<typeof onSave>[1] = null;
    if (
      isExpense &&
      (workUsePct !== initialWorkUsePct || bundledInWfh !== initialBundledInWfh)
    ) {
      taxPatch = {
        workUsePct: Math.max(0, Math.min(100, workUsePct)),
        bundledInWfh,
      };
    }

    const ok = await onSave(catPatch, taxPatch);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit category</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Parent</Label>
            <CategoryDropdown
              value={parentId || null}
              onChange={(v) => setParentId(v ?? "")}
              categories={cats}
              typeFilter={cat.type === "income" ? "income" : "expense"}
              // Exclude the cat itself + its subtree; excludeDescendants
              // covers the "candidate isn't a descendant of cat" rule.
              excludeIds={[cat.id]}
              // Tree-depth ceiling is 2 (three-level tree). Re-parenting
              // a cat whose subtree depth is `myDepth` means the deepest
              // descendant lands at `candidate.depth + 1 + myDepth`,
              // which must stay ≤ 2 — so candidate.depth ≤ 1 - myDepth.
              maxDepth={1 - myDepth}
              uncategorisedLabel="Top-level"
              triggerClassName="h-9 text-sm px-3 gap-1 text-foreground hover:bg-muted bg-background border rounded-md inline-flex items-center justify-between min-w-0 w-full disabled:opacity-50"
              popoverClassName="w-[var(--anchor-width)] p-0 gap-0 overflow-hidden min-w-72"
            />
            <p className="text-[11px] text-muted-foreground">
              {cat.type === "income" ? "Income" : "Expense"} category — only same-type parents are valid. Max nesting depth is 3.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex gap-1.5 flex-wrap">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "w-6 h-6 rounded-full border-2 transition-transform",
                    color === c
                      ? "border-foreground scale-110"
                      : "border-transparent",
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Colour ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Transfer kind</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                {
                  v: "none" as const,
                  label: "Regular",
                  hint: "Default — counts in cashflow as income or expense.",
                },
                {
                  v: "internal" as const,
                  label: "Inner transfer",
                  hint: "Between accounts you own (Checking → Savings). Excluded from cashflow rollups.",
                },
                {
                  v: "external" as const,
                  label: "External payment",
                  hint: "Payment to an untracked debt (external loan / CC). Counts as an expense.",
                },
              ]).map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setTransferKind(opt.v)}
                  className={cn(
                    "text-xs px-2 py-1.5 rounded-md border transition-colors text-left",
                    transferKind === opt.v
                      ? opt.v === "internal"
                        ? "border-amber-400/60 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                        : opt.v === "external"
                          ? "border-sky-400/60 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                          : "border-foreground/40 bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {transferKind === "internal"
                ? "Money moves between your own accounts. Excluded from income/expense rollups; only affects balance."
                : transferKind === "external"
                  ? "Payment to a debt you don't track here. Counted as an expense in cashflow."
                  : "Regular income/expense category."}
            </p>
          </div>

          {isExpense && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="cat-work-pct">Work-use %</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="cat-work-pct"
                    type="number"
                    min={0}
                    max={100}
                    step={5}
                    value={workUsePct}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      setWorkUsePct(Number.isNaN(n) ? 0 : n);
                    }}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">% claimable in the tax report</span>
                </div>
                {!taxRule && (
                  <p className="text-[11px] text-muted-foreground">
                    Default {auto.defaultPct}% (auto-classified from category path).
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 py-1">
                <div className="min-w-0">
                  <Label htmlFor="cat-wfh-bundle">Bundled in WFH</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Counts under the WFH fixed-rate hourly claim (utilities, internet, phone) instead of as a discrete deduction.
                  </p>
                </div>
                <Switch
                  id="cat-wfh-bundle"
                  checked={bundledInWfh}
                  onCheckedChange={setBundledInWfh}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="sm:justify-between gap-2">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={onDelete}
            disabled={saving}
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
