import { describe, expect, it } from "vitest";
import { classifyFindings } from "./_findings";
import type { MonkeyFinding } from "./_monkey-helpers";

const finding = (overrides: Partial<MonkeyFinding>): MonkeyFinding => ({
  page: "/x",
  action: "act",
  severity: "info",
  message: "msg",
  ...overrides,
});

describe("classifyFindings", () => {
  it("defaults missing kind to 'issue'", () => {
    const { issues, questions, verified } = classifyFindings([
      finding({ kind: undefined }),
    ]);
    expect(issues).toHaveLength(1);
    expect(questions).toHaveLength(0);
    expect(verified).toHaveLength(0);
  });

  it("splits the three kinds into separate buckets", () => {
    const input: MonkeyFinding[] = [
      finding({ kind: "issue", action: "i" }),
      finding({ kind: "question", action: "q" }),
      finding({ kind: "verified", action: "v" }),
    ];
    const { issues, questions, verified } = classifyFindings(input);
    expect(issues.map((f) => f.action)).toEqual(["i"]);
    expect(questions.map((f) => f.action)).toEqual(["q"]);
    expect(verified.map((f) => f.action)).toEqual(["v"]);
  });

  it("preserves order within each bucket", () => {
    const input: MonkeyFinding[] = [
      finding({ kind: "verified", action: "v1" }),
      finding({ kind: "verified", action: "v2" }),
      finding({ kind: "issue", action: "i1" }),
      finding({ kind: "verified", action: "v3" }),
    ];
    const { verified, issues } = classifyFindings(input);
    expect(verified.map((f) => f.action)).toEqual(["v1", "v2", "v3"]);
    expect(issues.map((f) => f.action)).toEqual(["i1"]);
  });

  it("returns empty arrays for an empty input", () => {
    const { issues, questions, verified } = classifyFindings([]);
    expect(issues).toEqual([]);
    expect(questions).toEqual([]);
    expect(verified).toEqual([]);
  });
});
