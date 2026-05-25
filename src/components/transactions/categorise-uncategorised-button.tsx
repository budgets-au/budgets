"use client";

import Link from "next/link";
import { useSwrJson } from "@/hooks/use-swr-json";
import { buttonVariants } from "@/components/ui/button";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

/** "Categorise uncategorised (N)" entry point on the transactions
 *  topbar. Sibling of the Import button — same surface area for
 *  the user, but operates on long-tail uncategorised rows that
 *  are already in the DB. Badge shows the count so the operator
 *  can see at-a-glance whether there's work to do. */
export function CategoriseUncategorisedButton() {
  // Use the categorise endpoint as the count source — it already
  // counts uncategorised rows (and runs the suggester, which is
  // wasted for the topbar count). For the topbar we just want the
  // length; a cheaper dedicated count endpoint isn't worth a new
  // route until this proves to be a hot path.
  const { data } = useSwrJson<Array<unknown>>(
    "/api/transactions/uncategorised-categorise",
    // Don't auto-revalidate this in the background — the user
    // clicking the button is the trigger to refresh.
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  const count = data?.length ?? 0;

  // Hide the button entirely when there's nothing to do; the user
  // sees a clean topbar instead of a misleading "(0)" badge.
  if (count === 0) return null;

  return (
    <Link
      href="/transactions/categorise"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      title={`${count} uncategorised transaction${count === 1 ? "" : "s"}`}
    >
      <ListChecks className="h-4 w-4 mr-1" />
      Categorise ({count})
    </Link>
  );
}
