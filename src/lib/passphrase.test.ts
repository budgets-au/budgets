import { describe, expect, it } from "vitest";
import { validatePassphrase } from "./passphrase";

describe("validatePassphrase", () => {
  it("returns null for any normal string", () => {
    expect(validatePassphrase("a")).toBeNull();
    expect(validatePassphrase("CorrectHorseBatteryStaple")).toBeNull();
    expect(validatePassphrase("hello world with spaces")).toBeNull();
    expect(validatePassphrase("p@ssw0rd!#$%^&*()")).toBeNull();
    // Non-ASCII printables — Unicode in passphrases is fine.
    expect(validatePassphrase("café résumé")).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(validatePassphrase(null)).toMatch(/must be a string/);
    expect(validatePassphrase(undefined)).toMatch(/must be a string/);
    expect(validatePassphrase(42)).toMatch(/must be a string/);
    expect(validatePassphrase({})).toMatch(/must be a string/);
  });

  it("rejects an empty string", () => {
    expect(validatePassphrase("")).toMatch(/must not be empty/);
  });

  it("rejects strings containing control characters in the 0x00–0x1F band", () => {
    expect(validatePassphrase("with\nnewline")).toMatch(/control character/);
    expect(validatePassphrase("with\rcarriage")).toMatch(/control character/);
    expect(validatePassphrase("with\ttab")).toMatch(/control character/);
    expect(validatePassphrase("with\0null")).toMatch(/control character/);
  });

  it("rejects 0x7F (DEL)", () => {
    expect(validatePassphrase(`with${String.fromCharCode(0x7f)}del`)).toMatch(
      /control character/,
    );
  });

  it("accepts space (0x20) — that's the bottom of the printable band", () => {
    expect(validatePassphrase(" leading-space")).toBeNull();
    expect(validatePassphrase("trailing-space ")).toBeNull();
    expect(validatePassphrase(" ")).toBeNull();
  });
});
