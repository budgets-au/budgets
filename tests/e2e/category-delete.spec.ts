import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  signInAsAdmin,
  seedAccount,
  seedTransaction,
  captureErrors,
} from "./_helpers";

/** E2E coverage for category DELETE behaviour (#21).
 *
 *  The route does two non-trivial things that any change to it
 *  could quietly break:
 *
 *   1. Children of a deleted category are PROMOTED one level
 *      (their `parentId` is rewritten to the deleted
 *      category's own parent — or null if the deleted category
 *      was a root).
 *   2. Linked transactions survive with `category_id` nulled
 *      (the FK is `ON DELETE SET NULL`).
 *
 *  Plus the standard 404 guard on a missing id.
 *
 *  This spec walks all three legs against a fresh,
 *  self-contained category tree so the assertions don't tangle
 *  with seed-data categories. */

const RUN_TOKEN = randomBytes(3).toString("hex");

interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  type: "income" | "expense";
  color: string;
}

interface TxnRow {
  id: string;
  categoryId: string | null;
}

test.describe("category-delete (#21)", () => {
  test("delete promotes children + nulls linked txns; missing id → 404", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Build a 3-level tree: grandparent → parent → child.
    //    Then delete the parent; assert child is reparented to
    //    grandparent.
    const grandparentRes = await request.post("/api/categories", {
      data: {
        name: `${RUN_TOKEN}-grand`,
        type: "expense",
        color: "#6366f1",
      },
    });
    expect(grandparentRes.status()).toBe(201);
    const grandparent = (await grandparentRes.json()) as CategoryRow;

    const parentRes = await request.post("/api/categories", {
      data: {
        name: `${RUN_TOKEN}-parent`,
        type: "expense",
        color: "#6366f1",
        parentId: grandparent.id,
      },
    });
    expect(parentRes.status()).toBe(201);
    const parent = (await parentRes.json()) as CategoryRow;

    const childRes = await request.post("/api/categories", {
      data: {
        name: `${RUN_TOKEN}-child`,
        type: "expense",
        color: "#6366f1",
        parentId: parent.id,
      },
    });
    expect(childRes.status()).toBe(201);
    const child = (await childRes.json()) as CategoryRow;

    // ── Link a transaction to the parent so we can verify the
    //    ON DELETE SET NULL contract.
    const account = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-acct`,
      type: "checking",
    });
    const txn = await seedTransaction(ctx, {
      accountId: account.id,
      date: "2026-05-20",
      amount: "-9.99",
      payee: `${RUN_TOKEN}-payee`,
      categoryId: parent.id,
    });
    expect(txn.id).toBeTruthy();

    try {
      // ── DELETE the middle node.
      const delRes = await request.delete(`/api/categories/${parent.id}`);
      expect(delRes.ok()).toBeTruthy();
      const delBody = (await delRes.json()) as { ok: boolean };
      expect(delBody.ok).toBe(true);

      // ── Child should now be parented to grandparent (one
      //    level up). The route promotes by rewriting parentId
      //    to the deleted category's `parentId`, NOT to null.
      const listRes = await request.get("/api/categories?type=expense");
      expect(listRes.ok()).toBeTruthy();
      const list = (await listRes.json()) as CategoryRow[];

      const childAfter = list.find((c) => c.id === child.id);
      expect(childAfter).toBeTruthy();
      expect(childAfter!.parentId).toBe(grandparent.id);

      // ── Parent should be gone from the list entirely.
      const parentAfter = list.find((c) => c.id === parent.id);
      expect(parentAfter).toBeUndefined();

      // ── Linked transaction survives with categoryId nulled
      //    (FK is `ON DELETE SET NULL`).
      const txnRes = await request.get(`/api/transactions/${txn.id}`);
      expect(txnRes.ok()).toBeTruthy();
      const txnAfter = (await txnRes.json()) as TxnRow;
      expect(txnAfter.id).toBe(txn.id);
      expect(txnAfter.categoryId).toBeNull();

      // ── DELETE missing id → 404. Lets a stale client tell
      //    "already deleted" from "deleted just now".
      const missingId = "00000000-0000-0000-0000-000000000000";
      const missingRes = await request.delete(
        `/api/categories/${missingId}`,
      );
      expect(missingRes.status()).toBe(404);
    } finally {
      // ── Cleanup: child + grandparent. (parent was the
      //    subject of the DELETE above.)
      await request
        .delete(`/api/categories/${child.id}`)
        .catch(() => {});
      await request
        .delete(`/api/categories/${grandparent.id}`)
        .catch(() => {});
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
