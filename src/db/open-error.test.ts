import { describe, expect, it } from "vitest";
import { describeOpenError } from "./open-error";

describe("describeOpenError", () => {
  it("flags EACCES with deploy-time guidance for volume permissions", () => {
    const msg = describeOpenError({ code: "EACCES" }, "/data/budget.db");
    expect(msg).toContain("Can't open");
    expect(msg).toContain("/data/budget.db");
    expect(msg).toContain("uid 1001");
    expect(msg).toContain("fsGroup");
  });

  it("EPERM gets the same volume-permission guidance (same root cause class)", () => {
    expect(describeOpenError({ code: "EPERM" }, "/data/db.db")).toContain(
      "Can't open",
    );
  });

  it("SQLITE_CANTOPEN ('unable to open database file') is treated as a permission failure", () => {
    // SQLCipher catches the EACCES on file-create internally and
    // surfaces its own opaque message, so we have to recognise the
    // string. In containerised deploys this is overwhelmingly a
    // volume-mount permission issue — the operator-facing copy is
    // the same fsGroup/chown guidance.
    const byMessage = describeOpenError(
      { message: "unable to open database file" },
      "/data/budget.db",
    );
    expect(byMessage).toContain("Can't open");
    expect(byMessage).toContain("uid 1001");
    expect(byMessage).toContain("fsGroup");

    const byCode = describeOpenError(
      { code: "SQLITE_CANTOPEN" },
      "/data/budget.db",
    );
    expect(byCode).toContain("Can't open");
    expect(byCode).toContain("uid 1001");
  });

  it("EROFS asks the operator to mount read-write", () => {
    const msg = describeOpenError({ code: "EROFS" }, "/data/budget.db");
    expect(msg).toContain("Read-only");
    expect(msg).toContain("/data/budget.db");
  });

  it("ENOSPC gets a 'disk full' message", () => {
    expect(describeOpenError({ code: "ENOSPC" }, "/data/db.db")).toContain(
      "Disk full",
    );
  });

  it("SQLCipher 'file is not a database' stays ambiguous to avoid leaking the cause", () => {
    // We don't tell the user whether the failure was a wrong key or
    // genuine corruption — both look the same to SQLCipher and we
    // don't want to give an oracle.
    const msg = describeOpenError(
      { message: "file is not a database" },
      "/data/budget.db",
    );
    expect(msg).toContain("Wrong passphrase or corrupted");
    expect(msg).not.toContain("/data/budget.db");
  });

  it("falls through to the raw message for unknown errors", () => {
    expect(
      describeOpenError({ message: "some weird sqlite quirk" }, "/data/db.db"),
    ).toBe("Failed to open the database: some weird sqlite quirk");
  });

  it("handles null / undefined / non-Error rejections without throwing", () => {
    expect(describeOpenError(null, "/data/db.db")).toBe(
      "Failed to open the database.",
    );
    expect(describeOpenError(undefined, "/data/db.db")).toBe(
      "Failed to open the database.",
    );
    expect(describeOpenError({}, "/data/db.db")).toBe(
      "Failed to open the database.",
    );
  });

  it("does not expose the path for the wrong-passphrase case (oracle hardening)", () => {
    // Even though a real EACCES message embeds the path, the
    // wrong-passphrase variant deliberately doesn't — we don't want
    // an attacker timing or message-comparing to learn the layout.
    const msg = describeOpenError(
      { message: "file is not a database" },
      "/secret/budget.db",
    );
    expect(msg).not.toContain("/secret");
  });
});
