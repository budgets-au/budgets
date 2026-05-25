/** Generic chunking helper for SQLite queries whose bound-parameter
 *  count scales with the size of an input array.
 *
 *  Background: SQLite's `SQLITE_MAX_VARIABLE_NUMBER` caps the number
 *  of `?` placeholders per prepared statement at 32766 in the
 *  `@signalapp/better-sqlite3` build we ship. Large-array
 *  `WHERE x IN (?, ?, …)` clauses and large bulk `INSERT … VALUES
 *  (…), (…), …` statements can blow past that cap silently and 500
 *  the request with the unhelpful error "too many SQL variables".
 *
 *  Wrap any such call site in `chunkedQuery(items, chunkSize, fn)`:
 *  the helper splits the input into safe-sized slices, fires the
 *  callback once per slice, and concatenates the returned rows. The
 *  caller never sees more than `chunkSize` items in a single
 *  prepared statement.
 *
 *  Pick `chunkSize` per call site:
 *   - Single-column `inArray` (1 param per item) — 5000 leaves
 *     plenty of headroom under the 32766 cap.
 *   - Bulk `INSERT … VALUES` with N fields per row — divide the
 *     cap by N and round down. 15 fields → 1500-row chunks.
 */
export async function chunkedQuery<T, R>(
  items: T[],
  chunkSize: number,
  fn: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  if (items.length === 0) return [];
  if (chunkSize <= 0) {
    throw new Error(`chunkedQuery: chunkSize must be positive (got ${chunkSize})`);
  }
  if (items.length <= chunkSize) return fn(items);
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    const rows = await fn(slice);
    if (rows.length > 0) out.push(...rows);
  }
  return out;
}

/** Like `chunkedQuery`, but for fire-and-forget operations whose
 *  return value the caller doesn't need (UPDATE, DELETE without
 *  `.returning()`, INSERT without `.returning()`). Same chunking
 *  semantics; just discards the per-chunk result. */
export async function chunkedExec<T>(
  items: T[],
  chunkSize: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  if (items.length === 0) return;
  if (chunkSize <= 0) {
    throw new Error(`chunkedExec: chunkSize must be positive (got ${chunkSize})`);
  }
  if (items.length <= chunkSize) {
    await fn(items);
    return;
  }
  for (let i = 0; i < items.length; i += chunkSize) {
    await fn(items.slice(i, i + chunkSize));
  }
}
