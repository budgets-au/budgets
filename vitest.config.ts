import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Pick up the `@/*` path alias from tsconfig.json natively (Vite ≥ 5).
    tsconfigPaths: true,
  } as unknown as Record<string, unknown>,
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", ".next", "dist"],
    // Tests are pure logic only — no Next.js runtime, no DB, no network.
    // Anything that needs the DB lives behind an interface that the test
    // shims with an in-memory fake.
  },
});
