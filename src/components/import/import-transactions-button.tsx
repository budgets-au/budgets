import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Topbar button that opens the import view. Cross-format dedup
 * (exact / legacy / heuristic-by-payee), inline category overrides,
 * balance reconciliation, and per-account routing all live there.
 * The committable batch goes through /api/import/commit-batched,
 * which migrates hashes forward and backfills missing fields rather
 * than re-inserting duplicates across format boundaries.
 */
export function ImportTransactionsButton() {
  return (
    <Link
      href="/import"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
    >
      <Upload className="h-4 w-4 mr-1" /> Import
    </Link>
  );
}
