import { Suspense } from "react";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { asc } from "drizzle-orm";
import { Topbar } from "@/components/layout/topbar";
import { CategoriseUncategorisedView } from "@/components/transactions/categorise-uncategorised-view";

/** "Categorise uncategorised" — the in-app companion to the CSV
 *  import's categorise step. Same suggester
 *  (`suggestCategoryByHistory`) but operates on already-imported,
 *  still-uncategorised rows in the DB. Lets the operator blow
 *  through a long-tail backlog without re-uploading anything. */
export default async function CategoriseUncategorisedPage() {
  const allCategories = await db
    .select({
      id: categories.id,
      name: categories.name,
      parentId: categories.parentId,
      type: categories.type,
    })
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name));

  // categories.type is text in the schema; the dropdown's `typeFilter`
  // is the narrower union. Cast at the boundary — the data is
  // constrained by an enum at write time (`accountTypeEnum` / the
  // POST schema's `z.enum(["income", "expense"])`).
  const typedCategories = allCategories.map((c) => ({
    ...c,
    type: c.type as "income" | "expense",
  }));

  return (
    <div>
      <Topbar title="Categorise uncategorised" />
      <div className="p-4 lg:p-6 space-y-4">
        <Suspense fallback={null}>
          <CategoriseUncategorisedView categories={typedCategories} />
        </Suspense>
      </div>
    </div>
  );
}
