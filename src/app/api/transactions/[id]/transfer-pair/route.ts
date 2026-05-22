import { NextResponse } from "next/server";
import { z } from "zod";
import { manualPair, manualPairExternal, manualUnpair } from "@/lib/transfer-match";
import { withAuthAndId } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

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

/** Issue #57: unified response shape across all three variants. Every
 *  branch returns the same `{ ok: true, syntheticId, externalAccountId,
 *  pairId }` envelope with nulls where the field doesn't apply. Was
 *  previously `{ok, syntheticId, externalAccountId}` for the external
 *  branch and `{ok}` for link/unpair — same endpoint, three shapes.
 *  Today's lone consumer (`link-transfer-dialog.tsx`) only reads
 *  `res.ok`, so this is non-breaking; the change is for future
 *  callers that want to follow the new pair id without a re-fetch. */
interface PairResponse {
  ok: true;
  syntheticId: string | null;
  externalAccountId: string | null;
  pairId: string | null;
}

export const PATCH = withAuthAndId(async (id, request) => {
  const parsed = await parseJsonBody(request, schema);
  if (!parsed.ok) return parsed.response;

  if ("external" in parsed.data) {
    const { syntheticId, externalAccountId } = await manualPairExternal(
      id,
      parsed.data.external,
    );
    const body: PairResponse = {
      ok: true,
      syntheticId,
      externalAccountId,
      pairId: syntheticId,
    };
    return NextResponse.json(body);
  }

  const { pairId } = parsed.data;
  if (pairId === null) {
    await manualUnpair(id);
    const body: PairResponse = {
      ok: true,
      syntheticId: null,
      externalAccountId: null,
      pairId: null,
    };
    return NextResponse.json(body);
  }
  if (pairId === id) {
    return NextResponse.json(
      { error: "Cannot pair a transaction with itself" },
      { status: 400 },
    );
  }
  await manualPair(id, pairId);
  const body: PairResponse = {
    ok: true,
    syntheticId: null,
    externalAccountId: null,
    pairId,
  };
  return NextResponse.json(body);
});
