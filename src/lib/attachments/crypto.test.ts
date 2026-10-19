import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  ATTACHMENT_CRYPTO,
  decryptBytes,
  encryptBytes,
} from "./crypto";

/** Unit coverage for the receipt-attachment crypto primitives.
 *
 *  The DEK round-trip, lazy init, and persistence paths all talk to
 *  the `app_settings` row and the SQLCipher-encrypted DB — those are
 *  covered by the integration test next to the API route
 *  (`route.integration.test.ts`). Here we're exercising only the
 *  pure-JS crypto helpers so the suite stays fast and DB-free.
 */

describe("encryptBytes / decryptBytes", () => {
  const dek = randomBytes(ATTACHMENT_CRYPTO.DEK_LEN);

  it("round-trips a short buffer", () => {
    const plaintext = Buffer.from("hello receipt world");
    const enc = encryptBytes(plaintext, dek);
    const dec = decryptBytes(enc, dek);
    expect(dec.toString("utf8")).toBe("hello receipt world");
  });

  it("round-trips a 1 MiB buffer", () => {
    const plaintext = randomBytes(1024 * 1024);
    const enc = encryptBytes(plaintext, dek);
    const dec = decryptBytes(enc, dek);
    expect(dec.equals(plaintext)).toBe(true);
  });

  it("appends the 12-byte nonce + 16-byte tag around the ciphertext", () => {
    const plaintext = Buffer.from("x");
    const enc = encryptBytes(plaintext, dek);
    // 12 nonce + 1 ct + 16 tag = 29 bytes
    expect(enc.length).toBe(
      ATTACHMENT_CRYPTO.NONCE_LEN + plaintext.length + ATTACHMENT_CRYPTO.TAG_LEN,
    );
  });

  it("rejects a tampered ciphertext (GCM auth check)", () => {
    const plaintext = Buffer.from("secret receipt text");
    const enc = encryptBytes(plaintext, dek);
    // Flip a bit in the middle of the ciphertext.
    const tampered = Buffer.from(enc);
    const i = ATTACHMENT_CRYPTO.NONCE_LEN + 3;
    tampered[i] = tampered[i] ^ 0x01;
    expect(() => decryptBytes(tampered, dek)).toThrow();
  });

  it("rejects decrypt under a different DEK", () => {
    const plaintext = Buffer.from("secret receipt text");
    const enc = encryptBytes(plaintext, dek);
    const otherDek = randomBytes(ATTACHMENT_CRYPTO.DEK_LEN);
    expect(() => decryptBytes(enc, otherDek)).toThrow();
  });

  it("rejects a truncated encrypted blob", () => {
    // Too short to even hold nonce + tag.
    expect(() => decryptBytes(Buffer.alloc(10), dek)).toThrow(
      /too short/i,
    );
  });

  it("each encrypt uses a fresh nonce", () => {
    const plaintext = Buffer.from("same plaintext");
    const a = encryptBytes(plaintext, dek);
    const b = encryptBytes(plaintext, dek);
    const nonceA = a.subarray(0, ATTACHMENT_CRYPTO.NONCE_LEN);
    const nonceB = b.subarray(0, ATTACHMENT_CRYPTO.NONCE_LEN);
    expect(nonceA.equals(nonceB)).toBe(false);
  });
});
