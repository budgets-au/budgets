import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  backupsToPrune,
  migrateLegacyBackups,
  type BackupEntry,
} from "./sqlite-backup";

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

describe("migrateLegacyBackups (#11)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "budgets-backup-test-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // The legacy filename regex matches `budgets_<type>_<chars>.sqlite`
  // where chars ∈ [0-9T.Z-]. ISO timestamps in the wild used either
  // colon-separated (`...T08:00:00Z`) or dash-separated formats. The
  // production code only ever produced the dash-separated form
  // (`...T08-00-00Z`), so the regex was tightened to match that
  // shape — keep the test fixtures aligned.
  const LEGACY_NAMES = [
    "budgets_manual_2026-05-20T08-00-00Z.sqlite",
    "budgets_manual_2026-05-20T08-00-00Z.sqlite.meta.json",
    "budgets_scheduled_2026-05-19T08-00-00Z.sqlite",
    "budgets_scheduled_2026-05-19T08-00-00Z.sqlite.meta.json",
    "budgets_pre-restore_2026-05-18T08-00-00Z.sqlite",
  ];

  it("moves legacy <base>/budgets_*.sqlite files into <base>/default/", () => {
    for (const name of LEGACY_NAMES) writeFileSync(join(root, name), "");
    migrateLegacyBackups(root);

    // Root should now be empty of legacy files.
    const rootEntries = readdirSync(root);
    expect(rootEntries).toEqual(["default"]);

    // Every legacy file landed under default/.
    const defaultEntries = readdirSync(join(root, "default")).sort();
    expect(defaultEntries).toEqual([...LEGACY_NAMES].sort());
  });

  it("leaves non-backup files alone (e.g. README, hidden files)", () => {
    writeFileSync(join(root, "README.md"), "operator notes");
    writeFileSync(join(root, ".DS_Store"), "");
    writeFileSync(
      join(root, LEGACY_NAMES[0]),
      "",
    );

    migrateLegacyBackups(root);

    // README + .DS_Store stay at root.
    expect(existsSync(join(root, "README.md"))).toBe(true);
    expect(existsSync(join(root, ".DS_Store"))).toBe(true);
    // The legacy file moved.
    expect(existsSync(join(root, LEGACY_NAMES[0]))).toBe(false);
    expect(existsSync(join(root, "default", LEGACY_NAMES[0]))).toBe(true);
  });

  it("is idempotent — re-running with default/ already present is a no-op", () => {
    mkdirSync(join(root, "default"), { recursive: true });
    writeFileSync(join(root, "default", "existing.sqlite"), "pre-existing");
    writeFileSync(join(root, LEGACY_NAMES[0]), "fresh-legacy");

    migrateLegacyBackups(root); // first pass: legacy → default
    migrateLegacyBackups(root); // second pass: no legacy left, no-op

    const defaultEntries = readdirSync(join(root, "default")).sort();
    expect(defaultEntries).toContain("existing.sqlite");
    expect(defaultEntries).toContain(LEGACY_NAMES[0]);
    // Root has only `default/`.
    expect(readdirSync(root)).toEqual(["default"]);
  });

  it("skips subdirectories under root (already per-profile-organised)", () => {
    mkdirSync(join(root, "default"), { recursive: true });
    mkdirSync(join(root, "second-profile"), { recursive: true });
    writeFileSync(join(root, LEGACY_NAMES[0]), "");

    migrateLegacyBackups(root);

    // Both subdirs survive.
    expect(existsSync(join(root, "second-profile"))).toBe(true);
    // The legacy file moved into default/.
    expect(existsSync(join(root, "default", LEGACY_NAMES[0]))).toBe(true);
  });

  it("returns silently when root doesn't exist (pre-first-unlock state)", () => {
    expect(() => migrateLegacyBackups(join(root, "does-not-exist"))).not.toThrow();
  });
});
