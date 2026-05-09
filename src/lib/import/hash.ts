import { createHash } from "crypto";

/**
 * Identity hash used to detect duplicate imports.
 *
 * The "new" form (current) folds in `rawId` so two transactions on the same
 * day for the same amount and payee — e.g. two HCF charges of $57 on Aug 28
 * with distinct OFX FITIDs — produce distinct hashes and both import.
 *
 * The "old" form (pre-2026-05) only used date/amount/payee and silently
 * collapsed any same-day duplicates into a single inserted row. Look it up
 * too so re-imports of pre-fix data still match correctly; on first re-import
 * the existing row's hash is migrated forward.
 */
export function newImportHash(r: { date: string; amount: string; payee: string; rawId: string }): string {
  return createHash("sha256")
    .update(`${r.date}|${r.amount}|${r.payee}|${r.rawId}`)
    .digest("hex");
}

export function oldImportHash(r: { date: string; amount: string; payee: string }): string {
  return createHash("sha256")
    .update(`${r.date}|${r.amount}|${r.payee}`)
    .digest("hex");
}
