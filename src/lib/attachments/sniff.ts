// Identify an upload by its leading bytes instead of trusting the browser's
// declared type. Returns the canonical MIME type, or null when the content
// isn't one of the allowed receipt formats.

export type ReceiptMime =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/heic"
  | "image/heif"
  | "application/pdf";

const ascii = (b: Buffer, start: number, end: number) => b.subarray(start, end).toString("latin1");

export function sniffReceiptType(b: Buffer): ReceiptMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return "image/png";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  // ISO-BMFF: [size][ftyp][major brand]
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (["heic", "heix", "heim", "heis", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1", "heif"].includes(brand)) return "image/heif";
  }
  return null;
}
