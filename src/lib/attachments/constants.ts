// Shared by the upload route, the expanded-row panel and the row popover.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

const BY_EXTENSION: Record<string, (typeof ALLOWED_TYPES)[number]> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
};

/** react-dropzone / `<input accept>` map. Extensions are listed so files the
 *  browser reports with an empty type (`.heic` on Windows) still pass. */
export const DROPZONE_ACCEPT: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "application/pdf": [".pdf"],
};

export const INPUT_ACCEPT = [...ALLOWED_TYPES, ...Object.keys(BY_EXTENSION).map((e) => `.${e}`)].join(",");

/** Client-side type check: the declared type, falling back to the extension.
 *  The server classifies by content regardless. */
export function receiptTypeOf(file: { name: string; type: string }): string | null {
  if ((ALLOWED_TYPES as readonly string[]).includes(file.type)) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

export function formatFileSize(bytes: number): string {
  const kb = Math.round(bytes / 1024);
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`;
}
