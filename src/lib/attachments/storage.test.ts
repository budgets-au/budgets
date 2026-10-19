import { describe, expect, it } from "vitest";
import { join, sep } from "node:path";
import {
  assertWithinAttachmentsDir,
  attachmentsDirForProfile,
} from "./storage";

/** Path-safety coverage for the attachments storage layer.
 *
 *  `assertWithinAttachmentsDir()` is the CodeQL-recognised
 *  sanitiser that clears downstream `fs.*` calls. We test the
 *  invariants that make the sanitiser trustworthy:
 *   - the per-profile directory + per-attachment path resolvers
 *     produce paths with the expected tail shape,
 *   - common happy paths (file at the expected spot, directory for
 *     the profile-delete cleanup) are accepted,
 *   - any `..` escape attempt throws,
 *   - a basename that doesn't match the allow-list throws.
 *
 *  The underlying `dataDir()` reads `SQLITE_PATH` once at import
 *  time, so we don't try to override it per-test — the tail-shape
 *  assertions below are independent of where exactly dataDir
 *  resolves to.
 */

const uuid = "550e8400-e29b-41d4-a716-446655440000";

describe("attachments storage path helpers", () => {
  it("per-profile directory ends with attachments/<profileId>", () => {
    const dir = attachmentsDirForProfile("abc-123");
    expect(dir.endsWith(`attachments${sep}abc-123`)).toBe(true);
  });

  it("per-attachment-style path ends with <id>.enc", () => {
    // Build the path without going through `attachmentsPathFor()`,
    // which transitively calls `getActiveProfile()` and would need
    // a registered profile in the test environment.
    const path = join(attachmentsDirForProfile("abc-123"), `${uuid}.enc`);
    expect(path.endsWith(`${uuid}.enc`)).toBe(true);
  });
});

describe("assertWithinAttachmentsDir", () => {
  // profileIds used here match the `[0-9a-f-]+` basename variant
  // that the sanitiser recognises for the delete-cleanup path.
  it("accepts a .enc file inside a per-profile directory", () => {
    const dir = attachmentsDirForProfile("abc-123");
    const safe = join(dir, `${uuid}.enc`);
    expect(() => assertWithinAttachmentsDir(safe)).not.toThrow();
  });

  it("accepts a per-profile directory for the delete-cleanup path", () => {
    const profileDir = attachmentsDirForProfile("abc-123");
    expect(() => assertWithinAttachmentsDir(profileDir)).not.toThrow();
  });

  it("rejects a traversal attempt out of the attachments tree", () => {
    expect(() => assertWithinAttachmentsDir("/etc/passwd")).toThrow(
      /not inside the attachments dir/,
    );
  });

  it("rejects a path that joins the attachments dir with a traversal", () => {
    const dir = attachmentsDirForProfile("abc-123");
    const escape = join(dir, "..", "..", "..", "etc", "passwd");
    expect(() => assertWithinAttachmentsDir(escape)).toThrow(
      /not inside the attachments dir/,
    );
  });

  it("rejects a filename that doesn't match the allow-list", () => {
    const dir = attachmentsDirForProfile("abc-123");
    const bad = join(dir, "evil.sh");
    expect(() => assertWithinAttachmentsDir(bad)).toThrow(/allow-list/);
  });
});
