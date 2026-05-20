import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Pick up the `@/*` path alias from tsconfig.json natively (Vite ≥ 5).
    tsconfigPaths: true,
  } as unknown as Record<string, unknown>,
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      // Pure-logic helpers that back the Playwright e2e suite. They
      // sit under tests/e2e/ next to the specs that use them but
      // import zero Playwright runtime, so Vitest can exercise them
      // directly. Naming convention: leading-underscore module files
      // get a colocated `_*.test.ts` (matches this glob); Playwright
      // specs use `*.spec.ts` (does not).
      "tests/e2e/_*.test.ts",
    ],
    exclude: ["node_modules", ".next", "dist"],
    // Tests are pure logic only — no Next.js runtime, no DB, no network.
    // Anything that needs the DB lives behind an interface that the test
    // shims with an in-memory fake.
  },
});
