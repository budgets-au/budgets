/** Explicit-run seed script. Identical to what happens automatically
 * after the first `/unlock` (the unlock path in `src/db/index.ts`
 * calls the same three seeders), kept for the dev workflow where
 * someone wants to re-key the demo dataset on demand.
 *
 * The defaults skip when there's already content. Pass `--force` to
 * re-seed even on a populated DB — useful when iterating on the
 * sample dataset itself. */

import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  db,
  seedSystemCategoriesIfMissing,
  seedSampleDataIfMissing,
} from "./index";
import {
  accounts,
  appSettings,
  payeeRules,
  scheduledTransactions,
  transactions,
  users,
} from "./schema";

const force = process.argv.includes("--force");

async function seed() {
  console.log("Seeding database...");

  // Idempotent default user. The web /unlock flow does the same
  // seed via seedDefaultUserIfMissing in src/db/index.ts; this
  // keeps the explicit script useful for `npm run db:seed`.
  const adminHash = await hash("admin", 12);
  await db
    .insert(users)
    .values({ name: "Admin", username: "admin", passwordHash: adminHash, role: "admin" })
    .onConflictDoNothing();
  console.log("✓ Default admin/admin user — change the password in Settings → Users.");

  if (force) {
    console.warn(
      "[seed] --force passed: clearing existing sample rows before re-seeding.",
    );
    await db.delete(transactions).where(eq(transactions.isSample, true));
    await db
      .delete(scheduledTransactions)
      .where(eq(scheduledTransactions.isSample, true));
    await db.delete(payeeRules).where(eq(payeeRules.isSample, true));
    await db.delete(accounts).where(eq(accounts.isSample, true));
    await db
      .update(appSettings)
      .set({ sampleDataSeeded: false, updatedAt: new Date() })
      .where(eq(appSettings.id, 1));
  }

  seedSystemCategoriesIfMissing();
  seedSampleDataIfMissing();

  console.log("Done.");
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
