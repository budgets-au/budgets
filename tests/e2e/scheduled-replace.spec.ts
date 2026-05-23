import { test, expect } from "@playwright/test";
import { signInAsAdmin, seedAccount, captureErrors } from "./_helpers";

/** E2E coverage for the schedule-replace ("rate change") flow (#15).
 *
 *  `POST /api/scheduled/[id]/replace` closes a predecessor schedule
 *  with `endDate = day before effective` + `isActive = false`, and
 *  creates a successor row inheriting payee/category/account/frequency
 *  with a new amount and start date. Both rows share the predecessor's
 *  `lineageId` so the chain queries as one logical recurring payment
 *  with rate changes through time.
 *
 *  Contract pinned:
 *
 *   1. Create a monthly schedule (predecessor) with amount -50.
 *   2. POST replace with newAmount=75, effectiveDate=<predecessor.startDate + 6 months>.
 *      Response: `{ predecessorId, successor: <row> }`.
 *   3. GET the predecessor — `endDate` is set, `isActive=false`,
 *      amount unchanged (still -50).
 *   4. GET the successor — amount is signed `-75.00` (predecessor
 *      was expense → negative magnitude preserved), startDate
 *      matches effective, lineageId matches predecessor's,
 *      isActive=true, endDate=null.
 *   5. POST replace with effectiveDate ≤ predecessor.startDate → 400.
 *   6. POST replace on a missing scheduledId → 404.
 *   7. Optional payee override: replace with `{ payee: "new-name" }`
 *     → successor.payee reflects the override, NOT the predecessor's
 *     payee. */

const RUN_TOKEN = Math.random().toString(36).slice(2, 8);

interface ScheduledRow {
  id: string;
  payee: string;
  amount: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  lineageId: string;
  frequency: string;
}

interface ReplaceResponse {
  predecessorId: string;
  successor: ScheduledRow;
}

test.describe("scheduled replace (#15)", () => {
  test("creates successor + closes predecessor; rejects bad effective date; payee override", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // ── Seed: account + predecessor schedule (monthly, expense).
    const account = await seedAccount(ctx, {
      name: `${RUN_TOKEN}-acct`,
      type: "checking",
    });
    const predecessorStart = "2026-01-01";
    const createRes = await request.post("/api/scheduled", {
      data: {
        accountId: account.id,
        payee: `${RUN_TOKEN}-rent`,
        amount: "-50",
        type: "expense",
        frequency: "monthly",
        startDate: predecessorStart,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const predecessor = (await createRes.json()) as ScheduledRow;
    expect(predecessor.id).toBeTruthy();
    expect(predecessor.isActive).toBe(true);

    try {
      // ── 1) Bad effective date — equal to predecessor.startDate → 400.
      const bad1 = await request.post(
        `/api/scheduled/${predecessor.id}/replace`,
        { data: { newAmount: "75", effectiveDate: predecessorStart } },
      );
      expect(bad1.status()).toBe(400);

      // ── 2) Missing scheduled id → 404.
      const missingId = "00000000-0000-0000-0000-000000000000";
      const bad2 = await request.post(
        `/api/scheduled/${missingId}/replace`,
        { data: { newAmount: "75", effectiveDate: "2026-07-01" } },
      );
      expect(bad2.status()).toBe(404);

      // ── 3) Happy path — effective 6 months in.
      const effective = "2026-07-01";
      const replaceRes = await request.post(
        `/api/scheduled/${predecessor.id}/replace`,
        { data: { newAmount: "75", effectiveDate: effective } },
      );
      expect(replaceRes.ok()).toBeTruthy();
      const replace = (await replaceRes.json()) as ReplaceResponse;
      expect(replace.predecessorId).toBe(predecessor.id);
      expect(replace.successor).toBeTruthy();
      expect(replace.successor.id).not.toBe(predecessor.id);

      // ── Successor invariants.
      const successor = replace.successor;
      expect(successor.startDate).toBe(effective);
      expect(successor.endDate).toBeNull();
      expect(successor.isActive).toBe(true);
      expect(successor.lineageId).toBe(predecessor.lineageId);
      expect(successor.frequency).toBe("monthly");
      // Sign was preserved from the predecessor's `expense` type.
      expect(parseFloat(successor.amount)).toBeCloseTo(-75, 2);
      // Payee was inherited (no override on this call).
      expect(successor.payee).toBe(predecessor.payee);

      // ── Predecessor mutations: endDate set to one day before
      //    effective, isActive=false, amount untouched. The
      //    by-id route doesn't have a GET handler — pull the list
      //    (filtered by isActive=false so closed predecessors
      //    surface) and find ours.
      const closedListRes = await request.get("/api/scheduled");
      expect(closedListRes.ok()).toBeTruthy();
      const closedList = (await closedListRes.json()) as ScheduledRow[];
      const predAfter = closedList.find((s) => s.id === predecessor.id);
      expect(predAfter, "predecessor present in inactive list").toBeTruthy();
      expect(predAfter!.endDate).toBe("2026-06-30");
      expect(predAfter!.isActive).toBe(false);
      expect(parseFloat(predAfter!.amount)).toBeCloseTo(-50, 2);

      // ── 4) Payee-override leg — replace the successor with a new
      //    rate AND a new payee.
      const overrideRes = await request.post(
        `/api/scheduled/${successor.id}/replace`,
        {
          data: {
            newAmount: "100",
            effectiveDate: "2027-01-01",
            payee: `${RUN_TOKEN}-rent-renamed`,
          },
        },
      );
      expect(overrideRes.ok()).toBeTruthy();
      const override = (await overrideRes.json()) as ReplaceResponse;
      expect(override.successor.payee).toBe(`${RUN_TOKEN}-rent-renamed`);
      expect(override.successor.lineageId).toBe(predecessor.lineageId);
    } finally {
      // ── Cleanup: delete every schedule on the lineage to leave
      //    the fixture in a known state.
      const listRes = await request.get("/api/scheduled");
      const list = (await listRes.json()) as ScheduledRow[];
      const ours = list.filter((s) => s.lineageId === predecessor.lineageId);
      for (const s of ours) {
        await request
          .delete(`/api/scheduled/${s.id}`)
          .catch(() => {});
      }
    }

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
