/** Next.js 16 instrumentation hook. `register()` fires once per Node
 *  process on `next start` boot — NOT during `next build`'s
 *  page-data collection fan-out, which is exactly the property we
 *  need to keep SQLCipher closed during build.
 *
 *  See `node_modules/next/dist/docs/01-app/...` for the contract.
 *
 *  Issue #81 — moving the auto-unlock-from-env trigger here breaks
 *  the SQLITE_BUSY race that had `src/db/index.ts:593-601` opening
 *  the file at module-evaluation time, which Next.js's build-time
 *  page-data collection (4 workers by default) hit in parallel.
 *  With this hook, the env-key unlock happens exactly once at server
 *  startup, after the build is done. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { autoUnlockFromEnv } = await import("@/db");
  autoUnlockFromEnv();
}
