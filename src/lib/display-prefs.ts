/**
 * User-tunable display preferences that live in localStorage. The shape
 * is here so future toggles can land without a fresh storage key each
 * time, and so the parse + merge logic stays pure-testable.
 */
export interface DisplayPrefs {
  /** Show the per-row "Weekly" column + footer on the scheduled list. */
  scheduledShowWeekly: boolean;
  /** Show the linked-transactions panel (direction gutter + counterpart
   * cells) on the right of the transactions list. Hide it for a
   * narrower / simpler table when transfer pairs aren't useful. */
  transactionsShowLinkedPanel: boolean;
}

export const DISPLAY_PREFS_DEFAULT: DisplayPrefs = {
  scheduledShowWeekly: true,
  transactionsShowLinkedPanel: true,
};

export const DISPLAY_PREFS_STORAGE_KEY = "display-prefs";

/** Merge a raw localStorage value with the defaults. Tolerates JSON
 * that's malformed, missing, or partially populated — every missing
 * key falls back to the default. Pure so the hook can stay thin and
 * the merge rules can be unit-tested without mocking localStorage. */
export function parseDisplayPrefs(raw: string | null): DisplayPrefs {
  if (!raw) return { ...DISPLAY_PREFS_DEFAULT };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DISPLAY_PREFS_DEFAULT };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...DISPLAY_PREFS_DEFAULT };
  }
  const obj = parsed as Record<string, unknown>;
  return {
    scheduledShowWeekly:
      typeof obj.scheduledShowWeekly === "boolean"
        ? obj.scheduledShowWeekly
        : DISPLAY_PREFS_DEFAULT.scheduledShowWeekly,
    transactionsShowLinkedPanel:
      typeof obj.transactionsShowLinkedPanel === "boolean"
        ? obj.transactionsShowLinkedPanel
        : DISPLAY_PREFS_DEFAULT.transactionsShowLinkedPanel,
  };
}
