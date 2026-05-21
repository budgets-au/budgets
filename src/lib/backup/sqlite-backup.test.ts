import { describe, expect, it } from "vitest";
import { backupsToPrune, type BackupEntry } from "./sqlite-backup";

function entry(overrides: Partial<BackupEntry>): BackupEntry {
  return {
    filename: "manual-2026-05-21T00-00-00Z.sqlite",
    type: "manual",
    size: 1024,
    mtime: "2026-05-21T00:00:00.000Z",
    notes: null,
    ...overrides,
  };
}

const sched = (i: number) =>
  entry({
    filename: `scheduled-2026-05-${String(21 - i).padStart(2, "0")}.sqlite`,
    type: "scheduled",
    // Older index → older mtime, so backupsToPrune's newest-first sort
    // surfaces a deterministic ordering even when caller hands them in.
    mtime: new Date(Date.UTC(2026, 4, 21 - i)).toISOString(),
  });

describe("backupsToPrune", () => {
  it("returns [] when there's nothing scheduled", () => {
    const result = backupsToPrune(
      [entry({ type: "manual" }), entry({ type: "pre-restore" })],
      5,
    );
    expect(result).toEqual([]);
  });

  it("returns [] when scheduled count is at or below retain cap", () => {
    expect(backupsToPrune([sched(0), sched(1)], 2)).toEqual([]);
    expect(backupsToPrune([sched(0)], 5)).toEqual([]);
  });

  it("returns scheduled backups past the retain cap, oldest first within the slice", () => {
    // 5 scheduled backups, retain=2 → expect 3 returned (the 3 oldest).
    const all = [sched(0), sched(1), sched(2), sched(3), sched(4)];
    const stale = backupsToPrune(all, 2);
    expect(stale.map((e) => e.filename)).toEqual([
      sched(2).filename,
      sched(3).filename,
      sched(4).filename,
    ]);
  });

  it("only considers scheduled backups for pruning (manual + pre-restore are sticky)", () => {
    const mixed = [
      entry({ type: "manual", mtime: "2020-01-01T00:00:00.000Z" }),
      sched(0),
      sched(1),
      entry({ type: "pre-restore", mtime: "2019-01-01T00:00:00.000Z" }),
      sched(2),
    ];
    const stale = backupsToPrune(mixed, 1);
    // Manual + pre-restore are old enough to be "stale" by mtime, but
    // their type makes them sticky. Only one of the three scheduled
    // backups is kept; the other two get pruned.
    expect(stale.every((e) => e.type === "scheduled")).toBe(true);
    expect(stale).toHaveLength(2);
  });

  it("handles unsorted input by sorting newest-first internally", () => {
    const shuffled = [sched(3), sched(0), sched(2), sched(1)];
    // retain=1 → keep the newest only (sched(0)), prune the other 3.
    const stale = backupsToPrune(shuffled, 1);
    expect(stale.map((e) => e.filename)).toEqual([
      sched(1).filename,
      sched(2).filename,
      sched(3).filename,
    ]);
  });

  it("treats retain=0 as 'prune them all'", () => {
    const all = [sched(0), sched(1)];
    expect(backupsToPrune(all, 0)).toHaveLength(2);
  });

  it("clamps fractional retain values down (defensive)", () => {
    const all = [sched(0), sched(1), sched(2)];
    // retain=1.7 → Math.floor → 1, prune the older two.
    expect(backupsToPrune(all, 1.7)).toHaveLength(2);
  });

  it("clamps negative retain to 0 (defensive)", () => {
    const all = [sched(0), sched(1)];
    expect(backupsToPrune(all, -3)).toHaveLength(2);
  });
});
