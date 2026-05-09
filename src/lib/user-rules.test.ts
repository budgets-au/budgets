import { describe, expect, it } from "vitest";
import {
  lastAdminGuard,
  validatePassword,
  validateRole,
  validateUsername,
} from "./user-rules";

describe("validateUsername", () => {
  it("accepts ascii letters / digits / dot / underscore / dash", () => {
    expect(validateUsername("admin")).toEqual({ ok: true });
    expect(validateUsername("Mixed_Case2026")).toEqual({ ok: true });
    expect(validateUsername("a.b-c")).toEqual({ ok: true });
    expect(validateUsername("X")).toEqual({ ok: true });
  });

  it("rejects empty / whitespace-only / non-string", () => {
    expect(validateUsername("").ok).toBe(false);
    expect(validateUsername("   ").ok).toBe(false);
    expect(validateUsername(undefined).ok).toBe(false);
    expect(validateUsername(42).ok).toBe(false);
  });

  it("rejects whitespace inside, @, slash, and other surprises", () => {
    expect(validateUsername("user@home.local").ok).toBe(false);
    expect(validateUsername("space user").ok).toBe(false);
    expect(validateUsername("path/traverse").ok).toBe(false);
    expect(validateUsername("emoji😀").ok).toBe(false);
  });

  it("trims surrounding whitespace silently (user-friendly typo recovery)", () => {
    // The validator trims before checking — accidental leading or
    // trailing spaces shouldn't lock the user out, but interior
    // spaces still fail (covered above).
    expect(validateUsername("  admin  ")).toEqual({ ok: true });
    expect(validateUsername("trail ")).toEqual({ ok: true });
  });

  it("rejects oversized usernames", () => {
    expect(validateUsername("a".repeat(33)).ok).toBe(false);
    expect(validateUsername("a".repeat(32)).ok).toBe(true);
  });
});

describe("validatePassword", () => {
  it("requires at least 4 characters", () => {
    expect(validatePassword("abc").ok).toBe(false);
    expect(validatePassword("abcd").ok).toBe(true);
    expect(validatePassword("a much longer one").ok).toBe(true);
  });

  it("rejects non-string", () => {
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword(123456).ok).toBe(false);
  });
});

describe("validateRole", () => {
  it("accepts 'admin' and 'member'", () => {
    expect(validateRole("admin").ok).toBe(true);
    expect(validateRole("member").ok).toBe(true);
  });

  it("rejects anything else", () => {
    expect(validateRole("root").ok).toBe(false);
    expect(validateRole("Admin").ok).toBe(false); // case-sensitive
    expect(validateRole("").ok).toBe(false);
    expect(validateRole(null).ok).toBe(false);
  });
});

describe("lastAdminGuard", () => {
  it("blocks self-delete with a specific error", () => {
    const out = lastAdminGuard({
      action: "delete",
      targetUserId: "u1",
      requesterUserId: "u1",
      currentAdmins: ["u1", "u2"],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("own account");
  });

  it("allows deleting another admin when there are multiple", () => {
    const out = lastAdminGuard({
      action: "delete",
      targetUserId: "u2",
      requesterUserId: "u1",
      currentAdmins: ["u1", "u2"],
    });
    expect(out.ok).toBe(true);
  });

  it("blocks deleting the LAST admin", () => {
    const out = lastAdminGuard({
      action: "delete",
      targetUserId: "u2",
      requesterUserId: "u1",
      currentAdmins: ["u2"],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("last admin");
  });

  it("allows deleting a non-admin even when only one admin remains", () => {
    // u2 is a member; deleting them never threatens admin coverage.
    const out = lastAdminGuard({
      action: "delete",
      targetUserId: "u2",
      requesterUserId: "u1",
      currentAdmins: ["u1"],
    });
    expect(out.ok).toBe(true);
  });

  it("blocks demoting the last admin", () => {
    const out = lastAdminGuard({
      action: "demote",
      targetUserId: "u1",
      requesterUserId: "u1",
      currentAdmins: ["u1"],
    });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("last admin");
  });

  it("allows demoting an admin when another admin remains", () => {
    const out = lastAdminGuard({
      action: "demote",
      targetUserId: "u2",
      requesterUserId: "u1",
      currentAdmins: ["u1", "u2"],
    });
    expect(out.ok).toBe(true);
  });

  it("self-demote is allowed when other admins exist (ok-but-be-careful path)", () => {
    // The endpoint is allowed to take a self-demote when someone
    // else is admin too. The UI confirm dialog can warn the user;
    // the rule itself only checks last-admin.
    const out = lastAdminGuard({
      action: "demote",
      targetUserId: "u1",
      requesterUserId: "u1",
      currentAdmins: ["u1", "u2"],
    });
    expect(out.ok).toBe(true);
  });

  it("demotion of a non-admin is a no-op decision but should pass through", () => {
    // The route handler can still apply the change; the guard's
    // job is only to flag dangerous actions.
    const out = lastAdminGuard({
      action: "demote",
      targetUserId: "u2",
      requesterUserId: "u1",
      currentAdmins: ["u1"],
    });
    expect(out.ok).toBe(true);
  });
});
