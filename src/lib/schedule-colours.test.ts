import { describe, expect, it } from "vitest";
import {
  BUDGET_PERIOD_COLOURS,
  FREQUENCY_COLOURS,
  LINEAGE_PREDECESSOR_COLOURS,
  colourForBudgetPeriod,
  colourForFrequency,
  colourForLineageRank,
  dimColour,
  freqLabel,
} from "./schedule-colours";

describe("colourForFrequency", () => {
  it("returns the palette colour for every known cadence", () => {
    for (const freq of Object.keys(FREQUENCY_COLOURS)) {
      expect(colourForFrequency(freq)).toBe(FREQUENCY_COLOURS[freq]);
    }
  });
  it("falls back to indigo for unknown frequencies", () => {
    expect(colourForFrequency("never-heard-of")).toBe("#6366f1");
  });
});

describe("colourForBudgetPeriod", () => {
  it("returns colours from the 24-entry palette", () => {
    for (let i = 0; i < BUDGET_PERIOD_COLOURS.length; i++) {
      expect(colourForBudgetPeriod(i)).toBe(BUDGET_PERIOD_COLOURS[i]);
    }
  });
  it("wraps around past the palette length", () => {
    expect(colourForBudgetPeriod(24)).toBe(BUDGET_PERIOD_COLOURS[0]);
    expect(colourForBudgetPeriod(25)).toBe(BUDGET_PERIOD_COLOURS[1]);
  });
  it("handles negative ranks (modulo-positive)", () => {
    expect(colourForBudgetPeriod(-1)).toBe(
      BUDGET_PERIOD_COLOURS[BUDGET_PERIOD_COLOURS.length - 1],
    );
  });
});

describe("colourForLineageRank", () => {
  it("rank 0 (latest) returns the cadence colour", () => {
    expect(colourForLineageRank(0, "monthly")).toBe(
      FREQUENCY_COLOURS["monthly"],
    );
    expect(colourForLineageRank(0, "weekly")).toBe(
      FREQUENCY_COLOURS["weekly"],
    );
  });
  it("rank ≥ 1 cycles through the lineage predecessor palette", () => {
    expect(colourForLineageRank(1, "monthly")).toBe(
      LINEAGE_PREDECESSOR_COLOURS[0],
    );
    expect(colourForLineageRank(2, "monthly")).toBe(
      LINEAGE_PREDECESSOR_COLOURS[1],
    );
    expect(colourForLineageRank(LINEAGE_PREDECESSOR_COLOURS.length + 1, "monthly")).toBe(
      LINEAGE_PREDECESSOR_COLOURS[0],
    );
  });
});

describe("dimColour", () => {
  it("default factor (0.65) returns a darker shade", () => {
    expect(dimColour("#ffffff")).toBe("#a6a6a6"); // 255 * 0.65 = 165.75 → A6
  });
  it("factor 0 → pure black", () => {
    expect(dimColour("#abcdef", 0)).toBe("#000000");
  });
  it("factor 1 → original colour", () => {
    expect(dimColour("#abcdef", 1)).toBe("#abcdef");
  });
  it("returns the input unchanged for non-hex strings", () => {
    expect(dimColour("rgb(0,0,0)")).toBe("rgb(0,0,0)");
    expect(dimColour("#abc")).toBe("#abc"); // 3-digit, not supported
  });
});

describe("freqLabel", () => {
  it("'once' renders as 'One-off' regardless of interval", () => {
    expect(freqLabel("once", 1)).toBe("One-off");
    expect(freqLabel("once", 4)).toBe("One-off");
  });
  it("'fortnightly' renders as 'Fortnightly' regardless of interval", () => {
    expect(freqLabel("fortnightly", 1)).toBe("Fortnightly");
    expect(freqLabel("fortnightly", 3)).toBe("Fortnightly");
  });
  it("interval=1 capitalises the cadence word", () => {
    expect(freqLabel("monthly", 1)).toBe("Monthly");
    expect(freqLabel("weekly", 1)).toBe("Weekly");
    expect(freqLabel("yearly", 1)).toBe("Yearly");
  });
  it("interval>1 reads as 'Every N <unit>'", () => {
    expect(freqLabel("monthly", 3)).toBe("Every 3 monthly");
    expect(freqLabel("weekly", 2)).toBe("Every 2 weekly");
  });
});
