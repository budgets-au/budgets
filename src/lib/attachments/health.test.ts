import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";

vi.mock("@/lib/db-profiles", () => ({
  getActiveProfile: () => ({ id: "default" }),
  dataDir: () => "/nonexistent",
}));

const { attachmentsHealthCheck } = await import("./health");

const isRoot = process.getuid?.() === 0;
let dir: string;
let prev: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attachments-health-"));
  prev = process.env.ATTACHMENTS_PATH;
  process.env.ATTACHMENTS_PATH = dir;
});
afterEach(() => {
  if (prev === undefined) delete process.env.ATTACHMENTS_PATH;
  else process.env.ATTACHMENTS_PATH = prev;
  for (const p of [dir, join(dir, "default")]) if (existsSync(p)) chmodSync(p, 0o700);
  rmSync(dir, { recursive: true, force: true });
});

describe("attachmentsHealthCheck", () => {
  it("probes the active profile's directory, where uploads are written", async () => {
    const result = await attachmentsHealthCheck();
    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(dir, "default"));
  });

  it("leaves no probe file behind", async () => {
    await attachmentsHealthCheck();
    expect(readdirSync(join(dir, "default"))).toEqual([]);
  });

  it("fails at mkdir when the root can't hold directories", async () => {
    process.env.ATTACHMENTS_PATH = "/dev/null/attachments-should-fail";
    const result = await attachmentsHealthCheck();
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("mkdir");
  });

  it.skipIf(isRoot)("reports EACCES when the root isn't writable", async () => {
    chmodSync(dir, 0o500);
    const result = await attachmentsHealthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/EACCES|Permission denied/i);
  });

  it.skipIf(isRoot)(
    "fails when the root is writable but the profile directory isn't (former false green)",
    async () => {
      mkdirSync(join(dir, "default"));
      chmodSync(join(dir, "default"), 0o500);
      const result = await attachmentsHealthCheck();
      expect(result.ok).toBe(false);
      expect(result.stage).toBe("write");
    },
  );
});
