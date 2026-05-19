import { describe, expect, it } from "vitest";
import {
  DISPLAY_PREFS_DEFAULT,
  parseDisplayPrefs,
} from "./display-prefs";

describe("parseDisplayPrefs", () => {
  it("returns the defaults when localStorage has nothing", () => {
    expect(parseDisplayPrefs(null)).toEqual(DISPLAY_PREFS_DEFAULT);
  });

  it("returns the defaults on malformed JSON", () => {
    expect(parseDisplayPrefs("not-json")).toEqual(DISPLAY_PREFS_DEFAULT);
    expect(parseDisplayPrefs("{")).toEqual(DISPLAY_PREFS_DEFAULT);
  });

  it("returns the defaults when JSON parses to a non-object (number, array, null)", () => {
    expect(parseDisplayPrefs("42")).toEqual(DISPLAY_PREFS_DEFAULT);
    expect(parseDisplayPrefs("null")).toEqual(DISPLAY_PREFS_DEFAULT);
    expect(parseDisplayPrefs("[true]")).toEqual(DISPLAY_PREFS_DEFAULT);
  });

  it("uses the stored value when present and well-typed", () => {
    expect(parseDisplayPrefs(`{"scheduledShowWeekly":false}`)).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      scheduledShowWeekly: false,
    });
    expect(parseDisplayPrefs(`{"transactionsShowLinkedPanel":false}`)).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      transactionsShowLinkedPanel: false,
    });
    expect(
      parseDisplayPrefs(
        `{"scheduledShowWeekly":false,"transactionsShowLinkedPanel":false}`,
      ),
    ).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      scheduledShowWeekly: false,
      transactionsShowLinkedPanel: false,
    });
  });

  it("accepts an already-parsed object (the API route path)", () => {
    // API route hands an object straight in rather than re-stringifying
    // the JSONB column. Same defaults-merge logic should apply.
    // `cashflowShowPlan` is the legacy boolean. When no explicit
    // `cashflowPlanMode` is present, the parser migrates a true
    // value to "plan" so the new three-way control reflects the
    // operator's prior setting.
    expect(parseDisplayPrefs({ cashflowShowPlan: true })).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      cashflowShowPlan: true,
      cashflowPlanMode: "plan",
    });
    // An explicit `cashflowPlanMode` wins over the legacy boolean
    // so once new code writes the explicit key it stays put even
    // if the boolean drifts.
    expect(
      parseDisplayPrefs({
        cashflowShowPlan: false,
        cashflowPlanMode: "diff",
      }),
    ).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      cashflowShowPlan: false,
      cashflowPlanMode: "diff",
    });
  });

  it("parses the enum + numeric fields with their tolerant validators", () => {
    expect(
      parseDisplayPrefs(`{"calendarViewMode":"week","transactionsPageSize":50}`),
    ).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      calendarViewMode: "week",
      transactionsPageSize: 50,
    });
    // Garbage values for enum / number land back on defaults.
    expect(
      parseDisplayPrefs(
        `{"calendarViewMode":"decade","transactionsPageSize":"oops","cashflowTotalsLevel":"galaxy"}`,
      ),
    ).toEqual(DISPLAY_PREFS_DEFAULT);
  });

  it("defaults feature flags to enabled and accepts an off-toggle", () => {
    // Both features start ON for new installs; only an explicit
    // false should switch them off. Missing/malformed entries land
    // back on the default — never silently disabled.
    expect(DISPLAY_PREFS_DEFAULT.featureInvestments).toBe(true);
    expect(DISPLAY_PREFS_DEFAULT.featureSuper).toBe(true);
    expect(
      parseDisplayPrefs(`{"featureInvestments":false,"featureSuper":false}`),
    ).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      featureInvestments: false,
      featureSuper: false,
    });
    expect(parseDisplayPrefs(`{"featureSuper":"nope"}`)).toEqual(
      DISPLAY_PREFS_DEFAULT,
    );
  });

  it("falls back to the default for individual keys whose stored value isn't a boolean", () => {
    // A field stored as a string ('false') would silently change semantics
    // if we coerced; instead we discard it and use the default.
    expect(parseDisplayPrefs(`{"scheduledShowWeekly":"false"}`)).toEqual(
      DISPLAY_PREFS_DEFAULT,
    );
  });

  it("ignores unknown keys without throwing", () => {
    // Forward-compat: a future build that adds a new pref shouldn't blow
    // up this parser when run against a saved blob from an older build.
    expect(
      parseDisplayPrefs(
        `{"scheduledShowWeekly":false,"futureKnob":"someValue"}`,
      ),
    ).toEqual({
      ...DISPLAY_PREFS_DEFAULT,
      scheduledShowWeekly: false,
    });
  });
});
