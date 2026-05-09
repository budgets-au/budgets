/**
 * Decision layer for the inline category picker on the import view.
 * Given what the user just picked, what's currently shown, what the
 * trigram suggester would predict on its own, and whether an existing
 * payee_rule is already overriding things, decide whether to write,
 * delete, or skip a rule.
 *
 * The whole point of this module is to keep the rules table small.
 * Most picks are confirmations — the user re-selects what's already
 * there, or accepts the trigram suggestion. Neither needs a rule.
 * Only genuine overrides (picked ≠ trigram suggestion) and reverts
 * (picked = trigram, but a stale rule still exists) should write.
 *
 * Pure function so the server can call it once per request without a
 * round-trip to the UI, and the UI's optimistic state can mirror the
 * server's behaviour.
 */
export type PayeeRuleDecision =
  | { action: "noop"; reason: "same-as-current" | "trigram-suffices" }
  | { action: "delete"; ruleId: string }
  | { action: "upsert"; categoryId: string };

export interface PayeeRuleDecisionInput {
  /** The category the user just picked from the dropdown. */
  picked: string;
  /** Whatever was shown as "current" before the pick. May come from
   * a rule, the trigram suggester, or an explicit prior pick. */
  currentCategoryId: string | null;
  /** What the trigram suggester would predict for this (payee, amount)
   * if no rule existed. `null` when no historical neighbours match. */
  trigramSuggestion: string | null;
  /** ID of an existing rule covering this (payee, amount) tuple, when
   * one exists. `null` for never-seen-before payees. */
  existingRuleId: string | null;
}

export function decidePayeeRuleAction(
  args: PayeeRuleDecisionInput,
): PayeeRuleDecision {
  // No-op on confirmations: user reopened the picker and selected the
  // same category that was already showing. Without this guard every
  // accidental click writes the same rule again with a fresh updatedAt.
  if (args.picked === args.currentCategoryId) {
    return { action: "noop", reason: "same-as-current" };
  }
  // Picked the trigram's own answer. The suggester would land on this
  // category for free — no rule needed.
  if (args.picked === args.trigramSuggestion) {
    if (args.existingRuleId) {
      // A stale rule was overriding the trigram. Drop it so future
      // imports follow the suggester (and any history changes flow
      // through naturally).
      return { action: "delete", ruleId: args.existingRuleId };
    }
    return { action: "noop", reason: "trigram-suffices" };
  }
  // Genuine override: the user wants a category neither the rule nor
  // the trigram would have produced. Write the rule.
  return { action: "upsert", categoryId: args.picked };
}
