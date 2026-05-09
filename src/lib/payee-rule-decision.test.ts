import { describe, expect, it } from "vitest";
import { decidePayeeRuleAction } from "./payee-rule-decision";

describe("decidePayeeRuleAction", () => {
  it("noop when the user re-picks the current category", () => {
    expect(
      decidePayeeRuleAction({
        picked: "cat-a",
        currentCategoryId: "cat-a",
        trigramSuggestion: "cat-b",
        existingRuleId: "rule-1",
      }),
    ).toEqual({ action: "noop", reason: "same-as-current" });
  });

  it("noop when the picked category equals the trigram suggestion and no rule exists", () => {
    expect(
      decidePayeeRuleAction({
        picked: "cat-a",
        currentCategoryId: null,
        trigramSuggestion: "cat-a",
        existingRuleId: null,
      }),
    ).toEqual({ action: "noop", reason: "trigram-suffices" });
  });

  it("deletes a stale rule when the user reverts to the trigram's pick", () => {
    expect(
      decidePayeeRuleAction({
        picked: "cat-a",
        currentCategoryId: "cat-b",
        trigramSuggestion: "cat-a",
        existingRuleId: "rule-99",
      }),
    ).toEqual({ action: "delete", ruleId: "rule-99" });
  });

  it("upserts when the picked category overrides both rule and trigram", () => {
    expect(
      decidePayeeRuleAction({
        picked: "cat-c",
        currentCategoryId: "cat-a",
        trigramSuggestion: "cat-b",
        existingRuleId: "rule-1",
      }),
    ).toEqual({ action: "upsert", categoryId: "cat-c" });
  });

  it("upserts on first-time categorisation (no current, no trigram, no rule)", () => {
    expect(
      decidePayeeRuleAction({
        picked: "cat-a",
        currentCategoryId: null,
        trigramSuggestion: null,
        existingRuleId: null,
      }),
    ).toEqual({ action: "upsert", categoryId: "cat-a" });
  });

  it("upserts when the trigram says nothing but the user wants a category", () => {
    expect(
      decidePayeeRuleAction({
        picked: "cat-a",
        currentCategoryId: null,
        trigramSuggestion: null,
        existingRuleId: null,
      }),
    ).toEqual({ action: "upsert", categoryId: "cat-a" });
  });

  it("'same-as-current' wins over 'trigram-suffices' when both apply (no API spam on a no-op pick)", () => {
    // Edge case: current === trigram === picked. We could short-circuit
    // either way; the same-as-current branch is checked first because
    // it's strictly cheaper to not even consider the trigram.
    const out = decidePayeeRuleAction({
      picked: "cat-a",
      currentCategoryId: "cat-a",
      trigramSuggestion: "cat-a",
      existingRuleId: null,
    });
    expect(out).toEqual({ action: "noop", reason: "same-as-current" });
  });

  it("delete-then-recreate isn't possible — picked equals trigram OR overrides, never both", () => {
    // When picked overrides the trigram AND a rule exists, we upsert
    // (the rule keeps living, with its category updated). We never
    // delete-then-create, because that would lose the rule's id.
    const out = decidePayeeRuleAction({
      picked: "cat-z",
      currentCategoryId: "cat-a",
      trigramSuggestion: "cat-b",
      existingRuleId: "rule-1",
    });
    expect(out).toEqual({ action: "upsert", categoryId: "cat-z" });
  });
});
