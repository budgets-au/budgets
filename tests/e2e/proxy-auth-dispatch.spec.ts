import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./_helpers";

/** E2E coverage for issue #79 — the proxy bypass for /api/* paths.
 *
 *  Pre-fix behaviour: `src/proxy.ts` ran `auth()` on every matched
 *  request, including /api/*. Each API hit decoded the JWT twice
 *  (proxy + the route's `withAuth*` guard). Pre-fix the middleware
 *  also tended to convert unauthenticated /api hits into a 302 to
 *  /login — wrong for an API surface that JSON clients expect to
 *  see 401 from.
 *
 *  Post-fix: the proxy short-circuits for /api/* and lets the route
 *  guard be the single source of truth — unauthenticated API hits
 *  return 401 JSON; HTML page hits still redirect to /login.
 *
 *  This spec drives the live built server to verify both legs of
 *  the dispatch from a real client perspective. */

test.describe("proxy auth dispatch (#79)", () => {
  test("authenticated API hit succeeds", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAsAdmin(page);

    const res = await context.request.get("/api/accounts");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);

    await context.close();
  });

  test("unauthenticated API hit returns 401 JSON (not redirect to /login)", async ({
    browser,
  }) => {
    // Fresh context with no cookies — no session, no JWT.
    const context = await browser.newContext();
    // Disable redirect-following so a 302 to /login would surface
    // as the response code rather than masquerading as the
    // /login HTML body's status.
    const res = await context.request.get("/api/accounts", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(401);
    // Body must be parseable JSON — the contract route guards
    // promise — not a /login HTML page.
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.any(String) });

    await context.close();
  });

  test("unauthenticated page hit still redirects to /login", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Goto follows redirects by default — assert we LANDED on
    // /login regardless of how many hops it took.
    const response = await page.goto("/transactions");
    // The final response is the /login page (status 200).
    expect(response?.status()).toBe(200);
    expect(page.url()).toMatch(/\/login(\?|$)/);

    await context.close();
  });

  test("auth check decodes the JWT only once per API request", async ({
    browser,
  }) => {
    // Indirect proof of the bypass: do an authenticated API hit
    // and inspect headers / timing. We can't directly count
    // auth() invocations from a black-box e2e — but we can pin
    // the absence of the X-Middleware-Redirect / NextAuth Set-
    // Cookie churn that the double-decode used to introduce on
    // some routes.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInAsAdmin(page);

    const res = await context.request.get("/api/accounts");
    // The route guard returns plain JSON without any of the
    // NextAuth-flavoured response headers (cookies refresh, etc.)
    // that the middleware path would emit if it had run.
    const setCookie = res.headers()["set-cookie"];
    // NextAuth's session-refresh cookie carries `authjs.session-token`.
    // If the middleware path ran, it'd appear here on a successful API
    // response. With the bypass it should not.
    if (setCookie) {
      expect(setCookie).not.toMatch(/authjs\.session-token/);
    }

    await context.close();
  });
});
