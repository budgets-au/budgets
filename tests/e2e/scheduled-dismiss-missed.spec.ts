import { test, expect } from "@playwright/test";
import {
  signInAsAdmin,
  getFirstAccountId,
  captureErrors,
} from "./_helpers";

/** E2E coverage for the dismiss-missed-scheduled flow (#16).
 *
 *  Two surfaces under test:
 *   - `POST /api/scheduled/[id]/dismiss-missed` — upserts a dismissal
 *      keyed on `(scheduledId, occurrenceDate)`. Re-POSTing with a
 *      new `note` amends in place; the test verifies idempotency.
 *   - `DELETE /api/scheduled/[id]/dismiss-missed?occurrenceDate=…`
 *      removes the dismissal. The 400 guard fires when
 *      `occurrenceDate` is missing.
 *   - `GET /api/scheduled/dismissed-missed` — the panel's data
 *      source for the dismissed-row toggle.
 *
 *  The `MissedScheduledPanel` UI (rendered on `/transactions`) also
 *  exercises this flow via the dismiss-confirm dialog and the
 *  restore button on the dismissed-row list. Covering the API
 *  contracts here keeps the spec terse and deterministic; a
 *  follow-up could add a UI leg via the panel.
 *
 *  Setup: seed a monthly schedule whose `startDate` is ~30 days in
 *  the past so the panel's 30-day window contains at least one
 *  missed occurrence. Issue #41 helpers (`seedAccount`-like) used.
 */

const RUN_TOKEN = `e2e-dismiss-${Date.now().toString(36)}`;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

test.describe("scheduled — dismiss / restore missed occurrence (#16)", () => {
  test("POST upsert + DELETE round-trip via /api/scheduled/[id]/dismiss-missed", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const ctx = page.context();
    const request = ctx.request;
    const { consoleErrors, pageErrors } = captureErrors(page);

    await signInAsAdmin(page);

    // Anchor against any non-archived account — the dismiss-missed
    // flow doesn't depend on which one, only on having a schedule
    // whose past occurrences are within the panel's 30-day window.
    const accountId = await getFirstAccountId(ctx);

    // Seed a monthly schedule starting 25 days ago — gives us one
    // past occurrence (the start date itself) inside the panel's
    // WINDOW_DAYS=30 sweep, comfortably outside the 4-day grace.
    const startDate = isoDaysAgo(25);
    const schedRes = await request.post("/api/scheduled", {
      data: {
        kind: "schedule",
        type: "expense",
        accountId,
        payee: `${RUN_TOKEN}-rent`,
        amount: "-1500",
        frequency: "monthly",
        interval: 1,
        startDate,
      },
    });
    expect(schedRes.ok()).toBeTruthy();
    const sched = (await schedRes.json()) as { id: string };
    expect(sched.id).toBeTruthy();

    // ── Baseline: no dismissals yet ────────────────────────────────
    const beforeRes = await request.get("/api/scheduled/dismissed-missed");
    expect(beforeRes.ok()).toBeTruthy();
    const beforeList = (await beforeRes.json()) as Array<{
      scheduledId: string;
      occurrenceDate: string;
    }>;
    expect(
      beforeList.find(
        (d) => d.scheduledId === sched.id && d.occurrenceDate === startDate,
      ),
    ).toBeUndefined();

    // ── POST: insert a dismissal with a note ──────────────────────
    const initialNote = "Already paid in cash";
    const insertRes = await request.post(
      `/api/scheduled/${sched.id}/dismiss-missed`,
      {
        data: { occurrenceDate: startDate, note: initialNote },
      },
    );
    expect(insertRes.ok()).toBeTruthy();

    const afterInsertRes = await request.get("/api/scheduled/dismissed-missed");
    const afterInsertList = (await afterInsertRes.json()) as Array<{
      scheduledId: string;
      occurrenceDate: string;
      note: string | null;
    }>;
    const inserted = afterInsertList.find(
      (d) => d.scheduledId === sched.id && d.occurrenceDate === startDate,
    );
    expect(inserted).toBeTruthy();
    expect(inserted?.note).toBe(initialNote);

    // ── Re-POST with a different note: idempotent upsert,
    //    amending the note in place rather than inserting a
    //    duplicate row ─────────────────────────────────────────────
    const amendedNote = "Rent was waived this month";
    const amendRes = await request.post(
      `/api/scheduled/${sched.id}/dismiss-missed`,
      {
        data: { occurrenceDate: startDate, note: amendedNote },
      },
    );
    expect(amendRes.ok()).toBeTruthy();

    const afterAmendRes = await request.get("/api/scheduled/dismissed-missed");
    const afterAmendList = (await afterAmendRes.json()) as Array<{
      scheduledId: string;
      occurrenceDate: string;
      note: string | null;
    }>;
    const amended = afterAmendList.filter(
      (d) => d.scheduledId === sched.id && d.occurrenceDate === startDate,
    );
    // Still exactly one row for this (scheduledId, occurrenceDate)
    // — the unique index prevents a duplicate.
    expect(amended).toHaveLength(1);
    expect(amended[0].note).toBe(amendedNote);

    // ── DELETE missing-param guard: 400 ───────────────────────────
    const noParamRes = await request.delete(
      `/api/scheduled/${sched.id}/dismiss-missed`,
    );
    expect(noParamRes.status()).toBe(400);

    // ── DELETE happy-path: removes the row ────────────────────────
    const delRes = await request.delete(
      `/api/scheduled/${sched.id}/dismiss-missed?occurrenceDate=${startDate}`,
    );
    expect(delRes.ok()).toBeTruthy();

    const finalRes = await request.get("/api/scheduled/dismissed-missed");
    const finalList = (await finalRes.json()) as Array<{
      scheduledId: string;
      occurrenceDate: string;
    }>;
    expect(
      finalList.find(
        (d) => d.scheduledId === sched.id && d.occurrenceDate === startDate,
      ),
    ).toBeUndefined();

    // No console / page errors during the walk.
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
