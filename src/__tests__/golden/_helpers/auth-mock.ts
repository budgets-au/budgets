/** Stand-in for the production `auth()` from `@/lib/auth`. Returns a
 * fixed test session so the route guards don't 401 our integration
 * tests. Use via `vi.mock("@/lib/auth", () => ({ auth: testAuth }))`
 * at the top of each golden test file. */
export const testAuth = async () => ({
  user: { id: "test-user", name: "Test", role: "admin" as const },
});
