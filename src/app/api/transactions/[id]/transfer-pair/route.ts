import { NextResponse } from "next/server";
import { z } from "zod";
import { manualPair, manualPairExternal, manualUnpair } from "@/lib/transfer-match";
import { withAuthAndId } from "@/lib/api/route-guards";

/** Three shapes accepted on this endpoint:
 *
 *   { pairId: <uuid> }               — link to another tracked transaction
 *   { pairId: null }                 — break the existing pair
 *   { external: <counterparty name> } — mint a synthetic stub in a
 *                                       (find-or-created) isExternal
 *                                       account named after the
 *                                       counterparty, then link.
 *
 * The third form is used when the user picks "Link as transfer" and the
 * other leg lives outside our tracked accounts (e.g. a separate bank
 * they've imported nothing from). See manualPairExternal for the
 * synthetic-leg lifecycle. */
const schema = z.union([
  z.object({ pairId: z.string().uuid().nullable() }),
  z.object({
    external: z.string().min(1).max(120),
  }),
]);

export const PATCH = withAuthAndId(async (id, request) => {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if ("external" in parsed.data) {
    const { syntheticId, externalAccountId } = await manualPairExternal(
      id,
      parsed.data.external,
    );
    return NextResponse.json({ ok: true, syntheticId, externalAccountId });
  }

  const { pairId } = parsed.data;
  if (pairId === null) {
    await manualUnpair(id);
  } else {
    if (pairId === id) {
      return NextResponse.json({ error: "Cannot pair a transaction with itself" }, { status: 400 });
    }
    await manualPair(id, pairId);
  }

  return NextResponse.json({ ok: true });
});
