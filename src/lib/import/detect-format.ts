export type FileFormat = "csv" | "ofx" | "qfx" | "qif";

export function detectFormat(filename: string, buffer: string): FileFormat {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "qif") return "qif";
  if (ext === "ofx") return "ofx";
  if (ext === "qfx") return "qfx";

  const head = buffer.slice(0, 512);
  if (head.includes("OFXHEADER:") || head.includes("<OFX>") || head.includes("<ofx>"))
    return "ofx";
  if (head.startsWith("!Type:") || head.startsWith("!Account"))
    return "qif";

  return "csv";
}
