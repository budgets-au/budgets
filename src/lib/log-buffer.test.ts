import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetLogBuffer,
  getRecentLogs,
  installConsoleHooks,
  type LogLevel,
} from "./log-buffer";

// The buffer is a module-scope singleton; every test resets it.
installConsoleHooks();

beforeEach(() => {
  __resetLogBuffer();
});

describe("log-buffer", () => {
  it("captures every console level", () => {
    console.log("a");
    console.info("b");
    console.warn("c");
    console.error("d");
    console.debug("e");
    const rows = getRecentLogs({ limit: 1000 });
    expect(rows.map((r) => r.level)).toEqual([
      "log",
      "info",
      "warn",
      "error",
      "debug",
    ]);
    expect(rows.map((r) => r.msg)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("filters by level", () => {
    console.warn("w1");
    console.log("l1");
    console.error("e1");
    console.warn("w2");
    const only: LogLevel[] = ["warn", "error"];
    const rows = getRecentLogs({ levels: only });
    expect(rows.map((r) => r.msg)).toEqual(["w1", "e1", "w2"]);
  });

  it("evicts oldest entries once the buffer overflows", () => {
    for (let i = 0; i < 1050; i++) console.log(`m${i}`);
    const rows = getRecentLogs({ limit: 1000 });
    // Cap is 1000 — earliest surviving entry should be m50.
    expect(rows.length).toBe(1000);
    expect(rows[0].msg).toBe("m50");
    expect(rows[rows.length - 1].msg).toBe("m1049");
  });

  it("clamps limit between 1 and 1000", () => {
    for (let i = 0; i < 100; i++) console.log(`m${i}`);
    expect(getRecentLogs({ limit: 0 }).length).toBe(1);
    expect(getRecentLogs({ limit: -5 }).length).toBe(1);
    // 5000 is above the cap — clamp to what's actually buffered.
    expect(getRecentLogs({ limit: 5000 }).length).toBe(100);
  });

  it("formats printf-style args via util.format", () => {
    console.info("hello %s, you have %d cats", "world", 3);
    const [row] = getRecentLogs({ limit: 1 });
    expect(row.msg).toBe("hello world, you have 3 cats");
  });
});
