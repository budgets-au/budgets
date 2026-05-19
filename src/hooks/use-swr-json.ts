import useSWR, { type Key, type SWRConfiguration, type SWRResponse } from "swr";

/** JSON fetcher used by every dashboard widget / report
 *  component / hook that reads a single endpoint. Throws on
 *  non-2xx so SWR returns `undefined` for `data` (instead of
 *  resolving an error-shaped body that callers would then try
 *  to `.filter()` / `.series` against). */
async function jsonFetcher<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

/** Thin wrapper around `useSWR` that bakes in the JSON fetcher.
 *  Replaces the `const fetcher = (url) => fetch(url).then(r => r.json())`
 *  lambda that was copy-pasted across ~50 React files. Use it
 *  anywhere the call site doesn't need bespoke fetcher
 *  behaviour. Falsy `key` (null / undefined / "") suspends the
 *  fetch — same SWR semantics. */
export function useSwrJson<T>(
  key: Key,
  config?: SWRConfiguration<T>,
): SWRResponse<T> {
  return useSWR<T>(key, jsonFetcher, config);
}
