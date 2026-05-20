import { NextResponse } from "next/server";
import { db } from "@/db";
import { payeeRules, categories } from "@/db/schema";
import { and, eq, asc, isNull } from "drizzle-orm";
import { z } from "zod";
import { suggestCategoryByHistory, loadTokenFreq } from "@/lib/categorize";
import { decidePayeeRuleAction } from "@/lib/payee-rule-decision";
import { withAuth } from "@/lib/api/route-guards";
import { parseJsonBody } from "@/lib/api/parse-body";

export const GET = withAuth(async () => {
  const rows = await db
    .select({
      id: payeeRules.id,
      normalizedPayee: payeeRules.normalizedPayee,
      categoryId: payeeRules.categoryId,
      categoryName: categories.name,
      source: payeeRules.source,
      confidence: payeeRules.confidence,
      updatedAt: payeeRules.updatedAt,
    })
    .from(payeeRules)
    .leftJoin(categories, eq(payeeRules.categoryId, categories.id))
    .orderBy(asc(payeeRules.normalizedPayee));

  return NextResponse.json(rows);
});

const createSchema = z.object({
  normalizedPayee: z.string().min(1),
  categoryId: z.string().uuid(),
  // Optional bounds — null/undefined means unbounded on that side, so a
  // user-set rule with no bounds applies to every amount for that payee.
  minAmount: z.string().nullable().optional(),
  maxAmount: z.string().nullable().optional(),
  // Context the picker uses to decide whether the rule is actually
  // needed. Both optional so the legacy single-arg POST (just payee +
  // category) still works.
  amount: z.string().optional(),
  currentCategoryId: z.string().uuid().nullable().optional(),
});

export const POST = withAuth(async (request) => {
  const parsed = await parseJsonBody(request, createSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  // Find a rule with the SAME (normalizedPayee, min, max) — if one
  // exists the picker treats it as the override layer that this pick
  // would update or remove.
  const minSame = data.minAmount
    ? eq(payeeRules.minAmount, data.minAmount)
    : isNull(payeeRules.minAmount);
  const maxSame = data.maxAmount
    ? eq(payeeRules.maxAmount, data.maxAmount)
    : isNull(payeeRules.maxAmount);
  const [existing] = await db
    .select({ id: payeeRules.id })
    .from(payeeRules)
    .where(and(eq(payeeRules.normalizedPayee, data.normalizedPayee), minSame, maxSame))
    .limit(1);

  // Ask the trigram suggester what it would pick on its own. If the
  // user's selection matches the suggester, no rule is needed — the
  // categorise pipeline already lands on the right category for free.
  // Skipped when no amount was provided (the legacy path); the rule
  // will be written unconditionally as before.
  let trigramSuggestion: string | null = null;
  if (data.amount !== undefined) {
    const amount = parseFloat(data.amount);
    if (Number.isFinite(amount)) {
      const freq = await loadTokenFreq();
      const suggestion = await suggestCategoryByHistory(
        data.normalizedPayee,
        amount,
        freq,
      );
      trigramSuggestion = suggestion?.categoryId ?? null;
    }
  }

  const decision = decidePayeeRuleAction({
    picked: data.categoryId,
    currentCategoryId: data.currentCategoryId ?? null,
    trigramSuggestion,
    existingRuleId: existing?.id ?? null,
  });

  if (decision.action === "noop") {
    return NextResponse.json({ noop: true, reason: decision.reason });
  }

  if (decision.action === "delete") {
    await db.delete(payeeRules).where(eq(payeeRules.id, decision.ruleId));
    return NextResponse.json({ deleted: true, ruleId: decision.ruleId });
  }

  // Upsert.
  if (existing) {
    await db
      .update(payeeRules)
      .set({
        categoryId: decision.categoryId,
        source: "user",
        confidence: 100,
        updatedAt: new Date(),
      })
      .where(eq(payeeRules.id, existing.id));
    return NextResponse.json({ id: existing.id, updated: true });
  }

  const [row] = await db
    .insert(payeeRules)
    .values({
      normalizedPayee: data.normalizedPayee,
      categoryId: decision.categoryId,
      minAmount: data.minAmount ?? null,
      maxAmount: data.maxAmount ?? null,
      source: "user",
      confidence: 100,
    })
    .returning({ id: payeeRules.id });
  return NextResponse.json({ id: row.id, updated: false });
});
