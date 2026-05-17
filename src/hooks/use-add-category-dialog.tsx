"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SearchableCombobox,
  type ComboboxItem,
} from "@/components/ui/searchable-combobox";
import { buildCategoryMeta } from "@/lib/category-path";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface CategoryDef {
  id: string;
  name: string;
  parentId: string | null;
  type: "income" | "expense";
}

/** Shape of the row returned by `POST /api/categories`. Forwarded
 *  verbatim to the `onCreated` callback so callers can immediately
 *  bind the new id (e.g. apply it to a transaction being edited or
 *  an import row whose category cell was empty). */
export interface CreatedCategory {
  id: string;
  name: string;
  parentId: string | null;
  type: "income" | "expense";
}

interface AddCategoryContext {
  /** Open the dialog. Optionally pre-fill type / parent / name, and
   *  receive the created row via `onCreated` (fires only on a
   *  successful POST). Used by the "Create '<query>'" affordance in
   *  the category pickers so the new category is selected the moment
   *  it lands. */
  open: (preset?: {
    type?: "income" | "expense";
    parentId?: string | null;
    name?: string;
    onCreated?: (cat: CreatedCategory) => void;
  }) => void;
}

const Ctx = createContext<AddCategoryContext | null>(null);

/** Hook for any component to pop the global Add-Category dialog open. */
export function useAddCategory(): AddCategoryContext {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error("useAddCategory must be used inside <AddCategoryProvider>");
  }
  return c;
}

export function AddCategoryProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"income" | "expense">("expense");
  const [parentId, setParentId] = useState("");
  const [loading, setLoading] = useState(false);
  // Held in a ref so the latest callback survives re-renders during
  // form submission without forcing the dialog to re-mount.
  const onCreatedRef = useRef<((cat: CreatedCategory) => void) | undefined>(
    undefined,
  );

  const { data: categories = [] } = useSWR<CategoryDef[]>(
    "/api/categories",
    fetcher,
  );

  const open = useCallback<AddCategoryContext["open"]>((preset) => {
    setName(preset?.name ?? "");
    setType(preset?.type ?? "expense");
    setParentId(preset?.parentId ?? "");
    onCreatedRef.current = preset?.onCreated;
    setIsOpen(true);
  }, []);

  function handleClose(next: boolean) {
    setIsOpen(next);
    if (!next) {
      setName("");
      setParentId("");
      onCreatedRef.current = undefined;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        type,
        parentId: parentId || null,
      }),
    });
    setLoading(false);
    if (res.ok) {
      const created = (await res.json().catch(() => null)) as
        | CreatedCategory
        | null;
      toast.success("Category created");
      setIsOpen(false);
      setName("");
      setParentId("");
      // Optimistically inject the new row into every subscriber's
      // cache so the picker that opened this dialog can render the
      // new category's label immediately on the same React tick that
      // its value flips to the new id. A background revalidation
      // still runs to keep the cache canonical. Awaiting the
      // optimistic write guarantees the cache is updated before the
      // onCreated callback fires its own state setters.
      if (created) {
        await globalMutate(
          "/api/categories",
          (current: CategoryDef[] | undefined) => {
            if (!current) return [created];
            if (current.some((c) => c.id === created.id)) return current;
            return [...current, created];
          },
          { revalidate: true },
        );
      }
      if (created && onCreatedRef.current) {
        onCreatedRef.current(created);
      }
      onCreatedRef.current = undefined;
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error ?? "Failed to create category");
    }
  }

  // Build the parent picker option list — restrict to the same type as
  // the new category so income/expense don't get crossed in the tree.
  const { meta } = buildCategoryMeta(categories);
  const parentItems: ComboboxItem[] = categories
    .filter((c) => c.type === type)
    .map((c) => {
      const m = meta.get(c.id);
      const path = m?.path ?? [c.name];
      return {
        id: c.id,
        label: path[path.length - 1],
        ancestors: path.slice(0, -1),
      };
    })
    .sort((a, b) =>
      [...(a.ancestors ?? []), a.label]
        .join(" / ")
        .localeCompare([...(b.ancestors ?? []), b.label].join(" / ")),
    );

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New category</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3 mt-1">
            <div className="space-y-1">
              <Label htmlFor="add-cat-name">Name</Label>
              <Input
                id="add-cat-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Groceries"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  const next = (v as "income" | "expense") ?? "expense";
                  setType(next);
                  // Cross-type parent no longer valid — clear it.
                  if (parentId) {
                    const cur = categories.find((c) => c.id === parentId);
                    if (cur && cur.type !== next) setParentId("");
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="expense">Expense</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Parent category (optional)</Label>
              <SearchableCombobox
                value={parentId}
                onChange={setParentId}
                items={parentItems}
                pinnedItems={[
                  { id: "", label: "None (top level)", italic: true },
                ]}
                searchPlaceholder="Search categories…"
                emptyTriggerLabel="None (top level)"
                triggerClassName="w-full text-sm border rounded-md px-3 py-2 bg-background h-auto inline-flex items-center justify-between gap-2"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                disabled={loading || !name.trim()}
                className="flex-1"
              >
                {loading ? "Creating…" : "Create"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
