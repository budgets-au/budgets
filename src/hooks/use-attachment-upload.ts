"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { MAX_UPLOAD_BYTES, receiptTypeOf } from "@/lib/attachments/constants";

const DOWNSCALE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_EDGE = 2000;
const DOWNSCALE_ABOVE_BYTES = 1.5 * 1024 * 1024;

/** Phone photos are 4–12 MB; every hover thumbnail decrypts and ships the
 *  whole file. Re-encode large images to a ~2000px JPEG before upload, and
 *  keep the original whenever re-encoding doesn't actually help. HEIC can't be
 *  decoded by canvas outside Safari, so it is sent as-is. */
async function downscale(file: File, type: string): Promise<File> {
  if (!DOWNSCALE_TYPES.has(type) || file.size <= DOWNSCALE_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Validate, shrink and POST receipt files for one transaction. */
export function useAttachmentUpload(transactionId: string, onUploaded?: () => void) {
  const [uploading, setUploading] = useState(0);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const accepted: Array<{ file: File; type: string }> = [];
      for (const f of files) {
        const type = receiptTypeOf(f);
        if (f.size === 0) toast.error(`${f.name}: file is empty`);
        else if (f.size > MAX_UPLOAD_BYTES) toast.error(`${f.name}: exceeds the 25 MB limit`);
        else if (!type) toast.error(`${f.name}: use a JPG, PNG, WebP, HEIC or PDF`);
        else accepted.push({ file: f, type });
      }
      if (accepted.length === 0) return;
      setUploading(accepted.length);
      let ok = 0;
      try {
        for (const { file, type } of accepted) {
          const body = new FormData();
          body.append("file", await downscale(file, type));
          const res = await fetch(`/api/transactions/${transactionId}/attachments`, {
            method: "POST",
            body,
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            toast.error(`${file.name}: ${err.error ?? `upload failed (${res.status})`}`);
          } else {
            ok++;
          }
          setUploading((n) => Math.max(0, n - 1));
        }
        if (ok) toast.success(ok === 1 ? "Receipt attached" : `${ok} receipts attached`);
      } finally {
        setUploading(0);
        if (ok) onUploaded?.();
      }
    },
    [transactionId, onUploaded],
  );

  return { uploading, uploadFiles };
}
