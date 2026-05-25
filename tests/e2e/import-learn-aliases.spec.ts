import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import {
  signInAsAdmin,
  seedAccount,
  captureErrors,
} from "./_helpers";

/** E2E coverage for the learn-aliases-on-commit flow (#10).
 *
 *  Two surfaces share the same backing function
 *  (`learnAccountAlias`):
 *
 *   - `POST /api/import/commit-batched` — auto-learns one alias
 *     per distinct `bankAccountId` it saw across the commit's
 *     rows. The response's `aliasesLearned` field is the count
 *     of truthful inserts (after the 0.263 fix).
 *   - `POST /api/import/learn-aliases` — direct batch saves
 *     from the import view's "save resolutions" button.
 *     Returns `{ saved: <truthful-insert-count> }`.
 *
 *  Contract pinned in this spec:
 *
 *   1. Commit a row with a fresh `bankAccountId` →
 *      `aliasesLearned: 1`.
 *   2. Re-commit a row with the SAME `bankAccountId` →
 *      `aliasesLearned: 0` (idempotent — already learned).
 *   3. Direct POST to `/api/import/learn-aliases` with a fresh
 *      mapping → `saved: 1`.
 *   4. Re-POST with the same mapping → `saved: 0`.
 *
 *  The "next import auto-resolves the alias" leg of the
 *  end-to-end story isn't exercised here — the categorise
 *  endpoint needs a real multipart-form CSV upload which is its
 *  own integration test. The aliases-learned counter being
 *  honest is enough to certify the persist side. */

const RUN_TOKEN = randomBytes(3).toString("hex");

function importHashFor(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

interface CommitResponse {
  imported: number;
  aliasesLearned: number;
  importLogIds: string[];
}

interface LearnAliasesResponse {
  saved: number;
}

test.describe("import learn-aliases (#10)", () => {
  test("commit-batched aliasesLearned + learn-aliases saved both report truthful inserts", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Seed: a fresh account so the alias lookup is unambiguous.
    const account = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-alias`,
      type: "checking",
    });

    const bankId = `BANK-${RUN_TOKEN}`;
    const date = "2026-05-10";

    // ── 1) First commit with a fresh bankAccountId — learns 1
    //    alias.
    const commit1 = await request.post("/api/import/commit-batched", {
      data: {
        filename: `${RUN_TOKEN}-1.csv`,
        format: "test",
        rows: [
          {
            accountId: account.id,
            date,
            amount: "-12.34",
            payee: `${RUN_TOKEN}-payee-A`,
            importHash: importHashFor([account.id, date, "A", bankId]),
            rawId: `${RUN_TOKEN}-A`,
            bankAccountId: bankId,
          },
        ],
      },
    });
    expect(commit1.ok()).toBeTruthy();
    const body1 = (await commit1.json()) as CommitResponse;
    expect(body1.imported).toBe(1);
    expect(body1.aliasesLearned).toBe(1);

    // ── 2) Second commit with the SAME bankAccountId — alias
    //    already in `account_aliases`, learn-leg is a no-op,
    //    aliasesLearned reports 0 (was 1 before the 0.263 fix
    //    when the route reported the INPUT count regardless).
    const commit2 = await request.post("/api/import/commit-batched", {
      data: {
        filename: `${RUN_TOKEN}-2.csv`,
        format: "test",
        rows: [
          {
            accountId: account.id,
            date,
            amount: "-56.78",
            payee: `${RUN_TOKEN}-payee-B`,
            importHash: importHashFor([account.id, date, "B", bankId]),
            rawId: `${RUN_TOKEN}-B`,
            bankAccountId: bankId,
          },
        ],
      },
    });
    expect(commit2.ok()).toBeTruthy();
    const body2 = (await commit2.json()) as CommitResponse;
    expect(body2.imported).toBe(1);
    expect(body2.aliasesLearned).toBe(0);

    // ── 3) Direct POST to learn-aliases with a fresh mapping →
    //    saved: 1.
    const directKey = `DIRECT-${RUN_TOKEN}`;
    const learn1 = await request.post("/api/import/learn-aliases", {
      data: {
        aliases: [
          { kind: "bank-account", value: directKey, accountId: account.id },
        ],
      },
    });
    expect(learn1.ok()).toBeTruthy();
    expect(((await learn1.json()) as LearnAliasesResponse).saved).toBe(1);

    // ── 4) Re-POST same mapping → saved: 0.
    const learn2 = await request.post("/api/import/learn-aliases", {
      data: {
        aliases: [
          { kind: "bank-account", value: directKey, accountId: account.id },
        ],
      },
    });
    expect(learn2.ok()).toBeTruthy();
    expect(((await learn2.json()) as LearnAliasesResponse).saved).toBe(0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
