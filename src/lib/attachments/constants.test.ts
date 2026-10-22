import { describe, expect, it } from "vitest";
import { formatFileSize, receiptTypeOf } from "./constants";

describe("receiptTypeOf", () => {
  it("trusts an allowed declared type", () => {
    expect(receiptTypeOf({ name: "a.bin", type: "image/png" })).toBe("image/png");
  });
  it("falls back to the extension when the browser reports no type", () => {
    expect(receiptTypeOf({ name: "IMG_0001.HEIC", type: "" })).toBe("image/heic");
  });
  it("rejects anything else", () => {
    expect(receiptTypeOf({ name: "evil.svg", type: "image/svg+xml" })).toBeNull();
    expect(receiptTypeOf({ name: "notes.txt", type: "" })).toBeNull();
  });
});

describe("formatFileSize", () => {
  it("uses KB under a megabyte and MB above", () => {
    expect(formatFileSize(10 * 1024)).toBe("10 KB");
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
});
