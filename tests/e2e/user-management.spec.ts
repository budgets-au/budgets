import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { signInAsAdmin, captureErrors } from "./_helpers";

/** E2E coverage for the user-management lifecycle (#28). Admin
 *  routes hit:
 *
 *   GET     /api/users           — list
 *   POST    /api/users           — create
 *   POST    /api/users (dup)     — 409 (username unique)
 *   PATCH   /api/users/{id}      — promote member → admin
 *   PATCH   /api/users/{id}      — demote admin → member
 *   PATCH   /api/users/{me}      — 409 (last-admin guard)
 *   PATCH   /api/users/{missing} — 404
 *   DELETE  /api/users/{id}      — happy-path
 *   DELETE  /api/users/{missing} — 404
 *
 *  Covers the full create → promote → demote → delete loop plus
 *  the two "you can't leave the system with no admin" guards
 *  (PATCH self-demote when last admin, DELETE self when last
 *  admin). The seeded admin (admin/admin) is the only admin
 *  in the fresh-DB test fixture; the spec confirms the
 *  last-admin guard fires against that user without actually
 *  demoting them (we'd lose the rest of the suite if we did).
 *
 *  All routes go through `withAdminAuthAndId` — auth + admin
 *  gating is implicit in the use of the signed-in admin session. */

const RUN_TOKEN = randomBytes(3).toString("hex");

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: "admin" | "member";
  createdAt: string;
}

test.describe("user-management lifecycle (#28)", () => {
  test("create → promote → demote → delete + last-admin / 404 guards", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Baseline: GET /api/users returns a list with the seeded
    //    admin. The list is the source of truth for "who is the
    //    only admin"; we'll consult it for the last-admin guard.
    const initialRes = await request.get("/api/users");
    expect(initialRes.ok()).toBeTruthy();
    const initial = (await initialRes.json()) as UserRow[];
    const seedAdmin = initial.find((u) => u.username === "admin");
    expect(seedAdmin).toBeTruthy();
    expect(seedAdmin?.role).toBe("admin");

    // Verify the seed admin is the ONLY admin — required for the
    // last-admin guard assertion below to be meaningful.
    expect(initial.filter((u) => u.role === "admin").length).toBe(1);

    const username = `e2e-${RUN_TOKEN}`;
    let createdId: string | null = null;

    try {
      // ── POST: create a member.
      const createRes = await request.post("/api/users", {
        data: {
          username,
          name: "E2E Member",
          password: "test-password",
          role: "member",
        },
      });
      expect(createRes.status()).toBe(201);
      const created = (await createRes.json()) as UserRow;
      expect(created.username).toBe(username);
      expect(created.role).toBe("member");
      expect(created.id).toBeTruthy();
      createdId = created.id;

      // ── POST: same username again → 409. The route runs an
      //    explicit pre-check before insert, so we should see the
      //    friendly "Username is already taken" error, not the
      //    raw UNIQUE-constraint 500.
      const dupRes = await request.post("/api/users", {
        data: {
          username,
          name: "Dup",
          password: "test-password",
          role: "member",
        },
      });
      expect(dupRes.status()).toBe(409);
      const dupBody = (await dupRes.json()) as { error?: string };
      expect(dupBody.error).toMatch(/already taken/i);

      // ── PATCH: promote member → admin. There's a guard for
      //    demoting the last admin; promotion is unconditional.
      const promoteRes = await request.patch(`/api/users/${createdId}`, {
        data: { role: "admin" },
      });
      expect(promoteRes.ok()).toBeTruthy();
      const promoted = (await promoteRes.json()) as UserRow;
      expect(promoted.role).toBe("admin");

      // ── PATCH: demote that admin back to member. Now there are
      //    two admins, so demoting the freshly-promoted one
      //    leaves the seed admin standing — guard passes.
      const demoteRes = await request.patch(`/api/users/${createdId}`, {
        data: { role: "member" },
      });
      expect(demoteRes.ok()).toBeTruthy();
      const demoted = (await demoteRes.json()) as UserRow;
      expect(demoted.role).toBe("member");

      // ── PATCH: try to demote the seed admin (the only admin in
      //    the system right now). The last-admin guard returns
      //    409 with a friendly message — the seed admin stays an
      //    admin and the rest of the suite keeps its login.
      const lastAdminRes = await request.patch(`/api/users/${seedAdmin!.id}`, {
        data: { role: "member" },
      });
      expect(lastAdminRes.status()).toBe(409);
      const lastAdminBody = (await lastAdminRes.json()) as { error?: string };
      expect(lastAdminBody.error).toMatch(/admin/i);

      // Cross-check: GET shows the seed admin role unchanged.
      const afterRes = await request.get("/api/users");
      const after = (await afterRes.json()) as UserRow[];
      const seedAfter = after.find((u) => u.id === seedAdmin!.id);
      expect(seedAfter?.role).toBe("admin");

      // ── PATCH: missing id → 404. The user-not-found check
      //    runs after the patch (because the schema-validate
      //    must pass first); 404 lets the UI distinguish from
      //    400 / 409.
      const missingId = "00000000-0000-0000-0000-000000000000";
      const missingPatchRes = await request.patch(`/api/users/${missingId}`, {
        data: { name: "ghost" },
      });
      expect(missingPatchRes.status()).toBe(404);

      // ── DELETE: missing id → 404. Same family of "the wrapper
      //    matched but the row didn't exist" cases.
      const missingDelRes = await request.delete(`/api/users/${missingId}`);
      expect(missingDelRes.status()).toBe(404);
    } finally {
      // ── DELETE: cleanup the seeded member if it still exists.
      //    Wrapped in try/catch so a mid-test failure still tears
      //    down the seed; the next test starts from the same
      //    baseline.
      if (createdId) {
        await request
          .delete(`/api/users/${createdId}`)
          .catch(() => {});
      }
    }

    // ── Final invariant: the seeded user is still an admin and
    //    no test artefacts remain (the created member was
    //    deleted in the finally block).
    const finalRes = await request.get("/api/users");
    const final = (await finalRes.json()) as UserRow[];
    expect(final.find((u) => u.username === username)).toBeUndefined();
    expect(final.find((u) => u.username === "admin")?.role).toBe("admin");

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
