import { mutate } from "swr";

/** Force every SWR cache entry whose key starts with `/api/cashflow` to
 * revalidate. Call after any schedule mutation (create/edit/delete/replace)
 * or forecast mutation so the calendar's two separate SWR fetches (visible
 * month + chart range) re-fetch on next paint instead of waiting for a focus
 * event or a hard refresh. `router.refresh()` only re-runs server components;
 * it doesn't touch client-side SWR caches. */
export function invalidateCashflow() {
  return mutate(
    (key) => typeof key === "string" && key.startsWith("/api/cashflow"),
    undefined,
    { revalidate: true },
  );
}
