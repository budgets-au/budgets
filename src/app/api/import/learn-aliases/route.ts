import { NextResponse } from "next/server";
import { z } from "zod";
import { learnAccountAlias } from "@/lib/import/resolve-account";
import { withAuth } from "@/lib/api/route-guards";

const bodySchema = z.object({
  aliases: z
    .array(
      z.object({
        kind: z.string().min(1),
        value: z.string().min(1),
        accountId: z.string().uuid(),
      }),
    )
    .min(1),
});

/**
 * Persist a batch of account-alias mappings — used by the import view's
 * "save these resolutions" button to lock in heuristic-match-derived
 * mappings without going through a full commit. Each entry is upserted
 * idempotently; conflicts (same kind+value already pointing elsewhere)
 * are NOT overwritten so a single bad heuristic doesn't trample a real
 * mapping.
 */
export const POST = withAuth(async (request) => {
  const body = await request.json();
  const { aliases } = bodySchema.parse(body);

  // Each alias upsert is independent — fire them in parallel so a 20-row
  // batch doesn't take 20 sequential round-trips.
  await Promise.all(
    aliases.map((a) => learnAccountAlias(a.kind, a.value, a.accountId)),
  );

  return NextResponse.json({ saved: aliases.length });
});
