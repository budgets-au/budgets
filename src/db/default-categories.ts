/** The 30 starter categories every fresh DB gets. Shared between the
 * unlock-time auto-seed (src/db/index.ts seedSystemCategoriesIfMissing)
 * and the explicit `npm run db:seed` script (src/db/seed.ts). Tagged
 * `isSystem = true` to mark them as part of the baseline ontology
 * rather than user-created entries. */
export interface DefaultCategorySeed {
  name: string;
  type: "income" | "expense";
  color: string;
}

export const DEFAULT_CATEGORIES: readonly DefaultCategorySeed[] = [
  // Income
  { name: "Salary", type: "income", color: "#22c55e" },
  { name: "Freelance", type: "income", color: "#16a34a" },
  { name: "Investment", type: "income", color: "#15803d" },
  { name: "Rental Income", type: "income", color: "#166534" },
  { name: "Other Income", type: "income", color: "#14532d" },
  // Expense
  { name: "Groceries", type: "expense", color: "#f97316" },
  { name: "Dining Out", type: "expense", color: "#ea580c" },
  { name: "Transport", type: "expense", color: "#dc2626" },
  { name: "Fuel", type: "expense", color: "#b91c1c" },
  { name: "Utilities", type: "expense", color: "#7c3aed" },
  { name: "Rent / Mortgage", type: "expense", color: "#6d28d9" },
  { name: "Insurance", type: "expense", color: "#5b21b6" },
  { name: "Health", type: "expense", color: "#ec4899" },
  { name: "Pharmacy", type: "expense", color: "#db2777" },
  { name: "Education", type: "expense", color: "#2563eb" },
  { name: "Entertainment", type: "expense", color: "#1d4ed8" },
  { name: "Subscriptions", type: "expense", color: "#1e40af" },
  { name: "Shopping", type: "expense", color: "#0891b2" },
  { name: "Clothing", type: "expense", color: "#0e7490" },
  { name: "Personal Care", type: "expense", color: "#0f766e" },
  { name: "Childcare", type: "expense", color: "#f59e0b" },
  { name: "Pets", type: "expense", color: "#d97706" },
  { name: "Home & Garden", type: "expense", color: "#65a30d" },
  { name: "Technology", type: "expense", color: "#4f46e5" },
  { name: "Travel", type: "expense", color: "#0284c7" },
  { name: "Gifts", type: "expense", color: "#c026d3" },
  { name: "Charity", type: "expense", color: "#e11d48" },
  { name: "Bank Fees", type: "expense", color: "#64748b" },
  { name: "Taxes", type: "expense", color: "#475569" },
  { name: "Transfer", type: "expense", color: "#94a3b8" },
  { name: "Uncategorised", type: "expense", color: "#cbd5e1" },
];
