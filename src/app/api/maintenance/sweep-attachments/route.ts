import { NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/route-guards";
import { sweepOrphanAttachmentFiles } from "@/lib/attachments/cleanup";

/** Remove receipt files left behind by deleted transactions. */
export const POST = withAdminAuth(async () => {
  try {
    return NextResponse.json(await sweepOrphanAttachmentFiles());
  } catch (e) {
    console.error("[maintenance/sweep-attachments] failed:", e);
    return NextResponse.json({ error: "Sweep failed; see the server log." }, { status: 500 });
  }
});
