import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./_helpers";

/** Backup → modify → restore round-trip.
 *
 * Smart-monkey (monkey-goals.spec.ts) can't drive this flow
 * because:
 *   - `restore` is destructive-banned in the click crawl —
 *     swapLive() closes the connection and re-locks the app,
 *     mid-spec.
 *   - The post-restore re-unlock + state-comparison legs need
 *     cross-page knowledge the monkey doesn't carry.
 *
 * This spec is the disaster-recovery contract: a backup taken
 * at time T must, when restored, return the live DB to the
 * exact state at T. Without this test a regression in
 * `swapLive()` / WAL handling / passphrase-rebind could silently
 * lose a household's ledger.
 *
 * Flow:
 *   1. Sign in (gives us a JWT cookie that survives the swap —
 *      the JWT references `admin` user id, which the restored
 *      DB also has because the seed runs identically).
 *   2. Snapshot baseline transaction count.
 *   3. POST /api/backup → manual snapshot.
 *   4. POST a marker transaction; verify it lands.
 *   5. POST /api/backup/restore with the snapshot filename +
 *      the test passphrase.
 *   6. POST /api/unlock to re-key the in-process connection.
 *   7. Re-fetch /api/transactions; assert the marker is gone
 *      and the count matches the baseline. */

const PASSPHRASE =
  process.env.E2E_SQLITE_KEY ??
  "0000000000000000000000000000000000000000000000000000000000000000";

const MARKER_PAYEE = "backup-restore-test-marker";

test.describe("disaster recovery: backup → modify → restore", () => {
  test("baseline snapshot survives a destructive add + restore", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    const request = page.context().request;

    // 1. Baseline. The fresh test DB has seed data but no
    // marker rows; record what's already there so the
    // post-restore assertion doesn't need to know.
    const baselineRes = await request.get("/api/transactions?limit=1000");
    expect(baselineRes.ok()).toBeTruthy();
    const baseline = (await baselineRes.json()) as Array<{
      payee: string | null;
    }>;
    const baselineCount = baseline.length;
    expect(
      baseline.some((t) => t.payee === MARKER_PAYEE),
      "marker should NOT pre-exist in the baseline",
    ).toBe(false);

    // 2. Take a manual backup. The response carries the entry
    // (filename + size + mtime) so we don't need a second GET.
    const backupRes = await request.post("/api/backup");
    expect(backupRes.ok()).toBeTruthy();
    const backupBody = (await backupRes.json()) as {
      ok: boolean;
      entry: { filename: string; type: string; size: number };
    };
    expect(backupBody.ok).toBe(true);
    expect(backupBody.entry.filename).toMatch(/\.sqlite$/);
    expect(backupBody.entry.size).toBeGreaterThan(0);
    const snapshotFilename = backupBody.entry.filename;

    // 3. Modify. Add a marker transaction so we can prove
    // restoration removed it. Need an account for the
    // POST — grab the first one in the seed.
    const accountsRes = await request.get("/api/accounts");
    expect(accountsRes.ok()).toBeTruthy();
    const accounts = (await accountsRes.json()) as Array<{ id: string }>;
    expect(accounts.length).toBeGreaterThan(0);
    const accountId = accounts[0].id;

    const addRes = await request.post("/api/transactions", {
      data: {
        accountId,
        date: "2026-03-15",
        amount: "-99.99",
        payee: MARKER_PAYEE,
      },
    });
    expect(addRes.ok()).toBeTruthy();

    // Confirm the marker is in the live DB before the restore —
    // if it isn't, the restore-removed-it test is moot.
    const afterAddRes = await request.get("/api/transactions?limit=1000");
    const afterAdd = (await afterAddRes.json()) as Array<{
      payee: string | null;
    }>;
    expect(afterAdd.length).toBe(baselineCount + 1);
    expect(afterAdd.some((t) => t.payee === MARKER_PAYEE)).toBe(true);

    // 4. Restore from the snapshot taken in step 2. After
    // this the live connection is closed and the app is
    // locked — subsequent DB reads will fail until step 5.
    const restoreRes = await request.post("/api/backup/restore", {
      data: {
        filename: snapshotFilename,
        passphrase: PASSPHRASE,
      },
    });
    expect(restoreRes.ok()).toBeTruthy();
    const restoreBody = (await restoreRes.json()) as {
      ok: boolean;
      redirect?: string;
    };
    expect(restoreBody.ok).toBe(true);
    expect(restoreBody.redirect).toBe("/unlock");

    // 5. Re-unlock — the keyed connection is in module memory,
    // and swapLive() closed it. POST /api/unlock re-opens it
    // against the restored file.
    const unlockRes = await request.post("/api/unlock", {
      data: { passphrase: PASSPHRASE },
    });
    expect(unlockRes.ok()).toBeTruthy();
    const unlockBody = (await unlockRes.json()) as { ok: boolean };
    expect(unlockBody.ok).toBe(true);

    // 6. State-after-restore matches state-before-the-marker.
    // The marker is gone; the row count is back to baseline.
    const afterRestoreRes = await request.get(
      "/api/transactions?limit=1000",
    );
    expect(afterRestoreRes.ok()).toBeTruthy();
    const afterRestore = (await afterRestoreRes.json()) as Array<{
      payee: string | null;
    }>;
    expect(afterRestore.length).toBe(baselineCount);
    expect(afterRestore.some((t) => t.payee === MARKER_PAYEE)).toBe(false);

    // 7. The backups dir now holds an auto-created
    // `pre-restore` snapshot (the user's forward-undo path).
    // NOTE: the original snapshot file is GONE from the
    // backups dir — swapLive() renames it into the live DB
    // path, so the file IS the new live DB. Asserting
    // "snapshot still on disk" would be wrong (was a bug
    // in the first version of this test).
    const listAfterRes = await request.get("/api/backup");
    expect(listAfterRes.ok()).toBeTruthy();
    const listBody = (await listAfterRes.json()) as {
      backups: Array<{ filename: string; type: string }>;
    };
    expect(
      listBody.backups.some((b) => b.type === "pre-restore"),
      "swapLive() should have taken a pre-restore snapshot before swap",
    ).toBe(true);
    expect(
      listBody.backups.some((b) => b.filename === snapshotFilename),
      "the consumed snapshot should be gone from the backups dir (swapLive renames it INTO the live path)",
    ).toBe(false);
  });

  /** Wrong-passphrase rejection. The restore route runs `verifyBackup`
   * (a SQLCipher open + PRAGMA cipher_integrity_check) BEFORE
   * swapLive() touches the live DB, so a typo on the operator's part
   * must surface as a 401 with the live DB untouched. A regression in
   * that ordering would mean a fat-fingered restore could nuke the
   * household ledger with a corrupt or wrong-key file. */
  test("wrong passphrase is rejected with 401 and leaves the live DB untouched", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await signInAsAdmin(page);
    const request = page.context().request;

    // Snapshot the live state so we can prove nothing moved after the
    // failed restore attempt.
    const beforeRes = await request.get("/api/transactions?limit=1000");
    expect(beforeRes.ok()).toBeTruthy();
    const before = (await beforeRes.json()) as Array<{ id: string }>;
    const beforeCount = before.length;

    // Take a snapshot to attempt restoring with a wrong passphrase
    // against. (We don't actually need this file's content to be
    // SQLCipher-correct — verifyBackup just needs SOMETHING to
    // attempt opening with the bad key.)
    const backupRes = await request.post("/api/backup");
    expect(backupRes.ok()).toBeTruthy();
    const backupBody = (await backupRes.json()) as {
      entry: { filename: string };
    };
    const snapshotFilename = backupBody.entry.filename;

    // Attempt restore with a wrong-but-valid-looking passphrase.
    // verifyBackup() opens the snapshot file with this key and runs
    // a cipher integrity check — the wrong key produces gibberish
    // bytes, integrity_check fails, the route returns 401.
    const restoreRes = await request.post("/api/backup/restore", {
      data: {
        filename: snapshotFilename,
        passphrase:
          "0badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbad",
      },
    });
    expect(restoreRes.status()).toBe(401);
    const restoreBody = (await restoreRes.json()) as {
      ok: boolean;
      error?: string;
    };
    expect(restoreBody.ok).toBe(false);

    // The live DB should be unchanged — we can still read it without
    // re-unlocking, and the row count matches the pre-attempt
    // snapshot. (A bug that swapped BEFORE verifying would have
    // left the connection closed or the file replaced.)
    const afterRes = await request.get("/api/transactions?limit=1000");
    expect(afterRes.ok()).toBeTruthy();
    const after = (await afterRes.json()) as Array<{ id: string }>;
    expect(after.length).toBe(beforeCount);

    // The snapshot we took above should STILL be on disk — a failed
    // restore must not consume the snapshot file.
    const listRes = await request.get("/api/backup");
    const listBody = (await listRes.json()) as {
      backups: Array<{ filename: string }>;
    };
    expect(
      listBody.backups.some((b) => b.filename === snapshotFilename),
      "snapshot must survive a failed restore attempt",
    ).toBe(true);
  });
});
