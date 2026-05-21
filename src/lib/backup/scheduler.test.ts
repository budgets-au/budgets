import { describe, expect, it } from "vitest";
import { shouldFireBackup } from "./scheduler";
import type { BackupSchedule } from "@/db/schema";

const MS_PER_DAY = 86_400_000;
const NOW = Date.parse("2026-05-21T12:00:00.000Z");

function cfg(overrides: Partial<BackupSchedule>): BackupSchedule {
  return {
    enabled: true,
    intervalDays: 1,
    retain: 7,
    lastRunAt: null,
    ...overrides,
  };
}

describe("shouldFireBackup", () => {
  it("returns false when disabled, regardless of cadence", () => {
    expect(shouldFireBackup(cfg({ enabled: false }), NOW)).toBe(false);
  });

  it("returns false when intervalDays is 0", () => {
    expect(shouldFireBackup(cfg({ intervalDays: 0 }), NOW)).toBe(false);
  });

  it("returns false when intervalDays is negative (defensive)", () => {
    expect(shouldFireBackup(cfg({ intervalDays: -1 }), NOW)).toBe(false);
  });

  it("fires on the very first tick when enabled and lastRunAt is null", () => {
    expect(shouldFireBackup(cfg({ lastRunAt: null }), NOW)).toBe(true);
  });

  it("fires when more than intervalDays have passed since lastRunAt", () => {
    const lastRunAt = new Date(NOW - 2 * MS_PER_DAY).toISOString();
    expect(shouldFireBackup(cfg({ intervalDays: 1, lastRunAt }), NOW)).toBe(
      true,
    );
  });

  it("fires exactly on the interval boundary", () => {
    const lastRunAt = new Date(NOW - MS_PER_DAY).toISOString();
    expect(shouldFireBackup(cfg({ intervalDays: 1, lastRunAt }), NOW)).toBe(
      true,
    );
  });

  it("does NOT fire when less than intervalDays have passed", () => {
    const lastRunAt = new Date(NOW - MS_PER_DAY / 2).toISOString();
    expect(shouldFireBackup(cfg({ intervalDays: 1, lastRunAt }), NOW)).toBe(
      false,
    );
  });

  it("weekly cadence: fires after 7 days, not at 6 days", () => {
    const sixDaysAgo = new Date(NOW - 6 * MS_PER_DAY).toISOString();
    const sevenDaysAgo = new Date(NOW - 7 * MS_PER_DAY).toISOString();
    expect(
      shouldFireBackup(cfg({ intervalDays: 7, lastRunAt: sixDaysAgo }), NOW),
    ).toBe(false);
    expect(
      shouldFireBackup(cfg({ intervalDays: 7, lastRunAt: sevenDaysAgo }), NOW),
    ).toBe(true);
  });
});
