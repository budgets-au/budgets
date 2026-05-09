import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function detectAccount(
  institution?: string,
  accountId?: string
): Promise<string | null> {
  const all = await db
    .select()
    .from(accounts)
    .where(eq(accounts.isArchived, false));

  if (!institution && !accountId) return null;

  for (const account of all) {
    // Match on last 4 digits of account number
    if (
      accountId &&
      account.accountNumberLast4 &&
      accountId.endsWith(account.accountNumberLast4)
    ) {
      return account.id;
    }

    // Fuzzy match on institution name
    if (institution && account.institution) {
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
      if (norm(institution).includes(norm(account.institution)) ||
          norm(account.institution).includes(norm(institution))) {
        return account.id;
      }
    }
  }

  return null;
}
