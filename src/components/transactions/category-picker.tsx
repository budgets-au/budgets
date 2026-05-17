"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CategoryDropdown, type CategoryLike } from "@/components/categories/category-dropdown";

/** Inline category cell on the transactions list. Wraps the shared
 * `CategoryDropdown` with the PATCH-and-refresh side-effect — the
 * dropdown itself doesn't know about the transactions API. */
export function CategoryPicker({
  transactionId,
  categoryId,
  categoryName,
  categories,
}: {
  transactionId: string;
  categoryId: string | null;
  // Retained for prop-API compatibility, even though the dropdown
  // resolves the trigger label from the categories list now.
  categoryName?: string | null;
  categories: CategoryLike[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const [value, setValue] = useState(categoryId ?? null);
  // Track the last prop we observed, NOT just the prop itself, so we
  // can tell "the parent changed it" from "we changed it locally."
  // Without this guard, a bulk-PATCH from the transactions toolbar
  // (which mutates the SWR cache to flip every selected row's
  // categoryId) leaves THIS picker's local `value` stuck on the
  // pre-update id forever — the trigger keeps showing the old
  // category until the row remounts (page refresh). With it, the
  // useEffect spots the prop change and syncs local state; in-flight
  // user picks aren't clobbered because the ref didn't see those
  // come through props.
  const lastSeenProp = useRef<string | null>(categoryId ?? null);
  useEffect(() => {
    const next = categoryId ?? null;
    if (lastSeenProp.current !== next) {
      lastSeenProp.current = next;
      setValue(next);
    }
  }, [categoryId]);

  async function applyValue(newValue: string | null) {
    const prev = value;
    setValue(newValue);
    setPending(true);
    const res = await fetch(`/api/transactions/${transactionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: newValue }),
    });
    setPending(false);
    if (!res.ok) {
      toast.error("Failed to update category");
      setValue(prev);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <CategoryDropdown
      value={value}
      onChange={applyValue}
      categories={categories}
      disabled={pending}
      triggerClassName="h-6 px-1 border-0 bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent"
    />
  );
}
