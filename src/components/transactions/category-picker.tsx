"use client";

import { useState, useTransition } from "react";
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
      triggerClassName="h-6 text-xs px-1 gap-1 text-muted-foreground hover:text-foreground hover:bg-accent rounded inline-flex items-center justify-between min-w-0 max-w-full disabled:opacity-50"
    />
  );
}
