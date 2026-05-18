/** sessionStorage bridge between the import flow and the
 * transactions page's topbar Undo button. After a successful
 * /api/import/commit-batched, the commit page stashes the
 * just-inserted importLogIds + a row count here, then navigates to
 * `/transactions`. The transactions page reads this on mount and
 * renders an Undo button next to the Import affordance in its
 * Topbar. The undo handler clears the key.
 *
 * sessionStorage (not localStorage / not a URL param) because:
 *  - the affordance is meaningful only for the current tab session,
 *  - we don't want the row IDs in the URL (long, ugly),
 *  - it survives the redirect and a hard reload of /transactions
 *    so an accidental F5 doesn't lose the Undo.
 *
 * Cleared on:
 *  - successful Undo click (the action consumed the IDs),
 *  - explicit Dismiss click,
 *  - 60 seconds after `committedAt` (the topbar arms a timer; the
 *    reader also drops a stale entry defensively so a different
 *    tab returning to /transactions doesn't see a stale offer),
 *  - tab close (sessionStorage lifetime). */

const KEY = "budgets:pending-undo-import";

/** How long the Undo offer stays alive after a commit lands. Past
 *  this, the entry is treated as gone (the operator's "moved on"). */
export const UNDO_IMPORT_TTL_MS = 60_000;

export interface PendingUndoImport {
  importLogIds: string[];
  imported: number;
  accountsTouched: number;
  /** Epoch ms when the commit landed — surfaced as "Just now" /
   * "2 m ago" on the Undo button so the operator knows the action
   * is fresh. */
  committedAt: number;
}

export function stashPendingUndoImport(value: PendingUndoImport): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // sessionStorage can throw in private-browsing / quota-exceeded
    // cases. The Undo is best-effort UX, not a correctness feature
    // — drop it on the floor rather than crash the commit.
  }
}

export function readPendingUndoImport(): PendingUndoImport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as PendingUndoImport).importLogIds) ||
      typeof (parsed as PendingUndoImport).imported !== "number"
    ) {
      return null;
    }
    const value = parsed as PendingUndoImport;
    // Drop entries past their TTL. The component arms a timer so
    // the live tab clears them precisely on schedule; this branch
    // covers the cross-tab case (a stale entry waiting in storage
    // when the operator switches back to /transactions after the
    // window has lapsed).
    if (
      typeof value.committedAt === "number" &&
      Date.now() - value.committedAt > UNDO_IMPORT_TTL_MS
    ) {
      clearPendingUndoImport();
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function clearPendingUndoImport(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* see stashPendingUndoImport */
  }
}
