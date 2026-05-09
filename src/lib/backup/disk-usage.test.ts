import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above the import statements, so the factory
// must look up its dependencies through vi.hoisted() rather than
// closing over a top-level `const statfsMock = vi.fn()` (which
// would still be in the TDZ when the mock factory runs).
const { statfsMock } = vi.hoisted(() => ({ statfsMock: vi.fn() }));
vi.mock("node:fs/promises", () => ({
  statfs: statfsMock,
}));

import {
  DISK_USAGE_CACHE_MS,
  __resetDiskUsageCache,
  diskUsage,
} from "./sqlite-backup";

describe("diskUsage cache", () => {
  beforeEach(() => {
    __resetDiskUsageCache();
    statfsMock.mockReset();
    statfsMock.mockResolvedValue({
      blocks: 1_000_000,
      bavail: 250_000,
      bsize: 4096,
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives totalBytes and freeBytes from statfs", async () => {
    const u = await diskUsage();
    expect(u).toEqual({
      totalBytes: 1_000_000 * 4096,
      freeBytes: 250_000 * 4096,
    });
  });

  it("returns the cached value within the window without re-syscalling", async () => {
    await diskUsage();
    await diskUsage();
    await diskUsage();
    expect(statfsMock).toHaveBeenCalledTimes(1);
  });

  it("re-runs statfs after the cache window elapses", async () => {
    await diskUsage();
    expect(statfsMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DISK_USAGE_CACHE_MS + 1);
    await diskUsage();
    expect(statfsMock).toHaveBeenCalledTimes(2);
  });

  it("__resetDiskUsageCache forces a fresh read on the next call", async () => {
    await diskUsage();
    __resetDiskUsageCache();
    await diskUsage();
    expect(statfsMock).toHaveBeenCalledTimes(2);
  });

  it("uses bavail (unprivileged-writable) rather than bfree", async () => {
    statfsMock.mockResolvedValueOnce({
      blocks: 100,
      bavail: 30,
      bfree: 50,
      bsize: 1024,
    });
    const u = await diskUsage();
    expect(u.freeBytes).toBe(30 * 1024);
  });
});
