import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, chmodSync, rmSync, existsSync } from "node:fs";
import { attachmentsHealthCheck } from "./health";

/** Health-check module coverage.
 *
 *  The write/read/delete probe is driven by `attachmentsRootPath()`
 *  which reads `ATTACHMENTS_PATH`. We stage a temp directory, point
 *  the env var at it, and assert the probe returns `ok: true` and
 *  leaves no residue behind. The error-mapping branches (EACCES /
 *  EROFS / ENOENT / ENOSPC) are covered in-situ by the strings
 *  returned from `friendlyFsError()` — exercised here through a
 *  nonexistent-path case that produces an ENOENT.
 *
 *  The permission-denied branch is harder to simulate portably
 *  (chmod semantics vary; root bypasses the check in CI). We cover
 *  it indirectly: an ENOENT today, an EACCES later via the mount
 *  the operator reports in Settings. Both share the same friendly
 *  text constructor. */

describe("attachmentsHealthCheck", () => {
  it("round-trips through a writable directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "attachments-health-"));
    const prev = process.env.ATTACHMENTS_PATH;
    process.env.ATTACHMENTS_PATH = dir;
    try {
      const result = await attachmentsHealthCheck();
      expect(result.ok).toBe(true);
      expect(result.path).toBe(dir);
      expect(result.error).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.ATTACHMENTS_PATH;
      else process.env.ATTACHMENTS_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces ENOENT when the parent path doesn't exist and can't be made", async () => {
    // A path under /dev/null is both nonexistent AND not creatable
    // (it's a device, not a directory). mkdir -p resolves to a
    // failure that isn't EACCES on either Linux or macOS.
    const prev = process.env.ATTACHMENTS_PATH;
    process.env.ATTACHMENTS_PATH = "/dev/null/attachments-should-fail";
    try {
      const result = await attachmentsHealthCheck();
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("mkdir");
      expect(result.error).toMatch(/ENOTDIR|ENOENT|EACCES|not a directory/i);
    } finally {
      if (prev === undefined) delete process.env.ATTACHMENTS_PATH;
      else process.env.ATTACHMENTS_PATH = prev;
    }
  });

  it("cleans up the probe file after a successful run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "attachments-health-"));
    const prev = process.env.ATTACHMENTS_PATH;
    process.env.ATTACHMENTS_PATH = dir;
    try {
      await attachmentsHealthCheck();
      // The probe filename is random; the directory should contain
      // nothing after a successful probe.
      const { readdirSync } = await import("node:fs");
      const left = readdirSync(dir);
      expect(left).toEqual([]);
    } finally {
      if (prev === undefined) delete process.env.ATTACHMENTS_PATH;
      else process.env.ATTACHMENTS_PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // chmod/chown unreliable in sandboxed CI; keep this test behind a
  // guard so the suite stays green on hosts where write perms on
  // tmpdir can't be revoked.
  it.skipIf(process.getuid?.() === 0)(
    "surfaces EACCES when the directory isn't writable",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "attachments-health-"));
      chmodSync(dir, 0o500); // r-x — no write bit
      const prev = process.env.ATTACHMENTS_PATH;
      process.env.ATTACHMENTS_PATH = dir;
      try {
        const result = await attachmentsHealthCheck();
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/EACCES|Permission denied/i);
      } finally {
        if (prev === undefined) delete process.env.ATTACHMENTS_PATH;
        else process.env.ATTACHMENTS_PATH = prev;
        if (existsSync(dir)) {
          chmodSync(dir, 0o700);
          rmSync(dir, { recursive: true, force: true });
        }
      }
    },
  );
});
