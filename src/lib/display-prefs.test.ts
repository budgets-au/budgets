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
      scheduledShowWeekly: false,
      transactionsShowLinkedPanel: true,
    });
    expect(parseDisplayPrefs(`{"transactionsShowLinkedPanel":false}`)).toEqual({
      scheduledShowWeekly: true,
      transactionsShowLinkedPanel: false,
    });
    expect(
      parseDisplayPrefs(
        `{"scheduledShowWeekly":false,"transactionsShowLinkedPanel":false}`,
      ),
    ).toEqual({ scheduledShowWeekly: false, transactionsShowLinkedPanel: false });
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
      scheduledShowWeekly: false,
      transactionsShowLinkedPanel: true,
    });
  });
});
