import { describe, expect, it } from "vitest";
import { sniffReceiptType } from "./sniff";

const bmff = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftyp" + brand)]);

describe("sniffReceiptType", () => {
  it.each([
    ["jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]), "image/jpeg"],
    ["png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "image/png"],
    ["webp", Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/webp"],
    ["pdf", Buffer.from("%PDF-1.7\n"), "application/pdf"],
    ["heic", bmff("heic"), "image/heic"],
    ["heif", bmff("mif1"), "image/heif"],
  ])("recognises %s", (_n, buf, mime) => {
    expect(sniffReceiptType(buf)).toBe(mime);
  });

  it.each([
    ["html", Buffer.from("<!doctype html><script>alert(1)</script>")],
    ["svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ["mp4", bmff("isom")],
    ["empty", Buffer.alloc(0)],
  ])("rejects %s", (_n, buf) => {
    expect(sniffReceiptType(buf)).toBeNull();
  });
});
