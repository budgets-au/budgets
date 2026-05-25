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
  // Dedicated cheap COUNT(*) endpoint — the full categorise
  // pipeline (trigram suggestions + 2 MB JSON payload) is wasted
  // work when we only want the badge number, and dominates
  // /transactions first-paint once the queue gets large.
  const { data } = useSwrJson<{ count: number }>(
    "/api/transactions/uncategorised-count",
    // Don't auto-revalidate this in the background — the user
    // clicking the button is the trigger to refresh.
    { revalidateOnFocus: false, revalidateIfStale: false },
  );
  const count = data?.count ?? 0;

  // Hide the button entirely when there's nothing to do; the user
  // sees a clean topbar instead of a misleading "(0)" badge.
  if (count === 0) return null;

  return (
    <Link
      href="/import?mode=uncat"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
      title={`${count} uncategorised transaction${count === 1 ? "" : "s"}`}
    >
      <ListChecks className="h-4 w-4 mr-1" />
      Categorise ({count})
    </Link>
  );
}
