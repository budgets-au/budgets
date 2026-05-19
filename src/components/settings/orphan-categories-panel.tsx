"use client";

import useSWR, { mutate } from "swr";
import { Loader2, Trash2, Tag } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { toast } from "sonner";

interface OrphanResp {
  orphans: Array<{ id: string; name: string; parentId: string | null }>;
  count: number;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load");
  return res.json();
};

/** Settings-page admin tool. Surfaces categories that have no
 * transactions, no scheduled rows, no children, and aren't system
 * seeds — i.e. dead-wood the operator created in a moment of
 * over-categorisation and never used. One-click removes them all. */
export function OrphanCategoriesPanel() {
  const { data, isLoading, error } = useSWR<OrphanResp>(
    "/api/categories/orphans",
    { revalidateOnFocus: false },
  );
  const confirm = useConfirm();
  const [removing, setRemoving] = useState(false);

  if (error) {
    // Non-admin → 403; hide silently rather than show a "you can't"
    // box. Admins on a fresh DB see "nothing to clean".
    return null;
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border bg-card divide-y">
        <div className="px-4 py-3">
          <h2 className="font-medium">Unused categories</h2>
        </div>
        <div className="px-4 py-4 text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
        </div>
      </div>
    );
  }

  async function remove() {
    const ok = await confirm({
      title: `Remove ${data!.count} unused categor${data!.count === 1 ? "y" : "ies"}?`,
      description: `These categories have no transactions, no scheduled rows, and no sub-categories. They're not system seeds. The deletion is permanent — a fresh seed of defaults won't restore them.`,
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (!ok) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/categories/orphans", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error ?? "Removal failed");
      }
      toast.success(`Removed ${body.removed} categor${body.removed === 1 ? "y" : "ies"}`);
      mutate("/api/categories/orphans");
      mutate("/api/categories");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="rounded-xl border bg-card divide-y">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-medium">Unused categories</h2>
        </div>
      </div>
      <div className="px-4 py-3 space-y-2">
        {data.count === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to clean — every category has at least one transaction,
            scheduled row, or child category.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {data.count} categor{data.count === 1 ? "y has" : "ies have"} no
              activity. Removing them tidies the picker dropdown without
              touching any data.
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 ml-1 max-h-40 overflow-y-auto">
              {data.orphans.slice(0, 30).map((o) => (
                <li key={o.id}>· {o.name}</li>
              ))}
              {data.orphans.length > 30 && (
                <li className="italic">
                  …and {data.orphans.length - 30} more
                </li>
              )}
            </ul>
          </>
        )}
      </div>
      {data.count > 0 && (
        <div className="px-4 py-3 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={remove}
            disabled={removing}
          >
            {removing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="mr-1 h-3.5 w-3.5" />
            )}
            Remove {data.count}
          </Button>
        </div>
      )}
    </div>
  );
}
