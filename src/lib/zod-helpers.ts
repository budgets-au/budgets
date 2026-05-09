import { z } from "zod";

/**
 * Strict numeric-string schema: rejects "", "abc", "NaN", "Infinity",
 * scientific notation, leading/trailing whitespace. Accepts integers and
 * decimals with optional sign. Use everywhere amounts arrive as strings
 * over the wire (Drizzle's `numeric(p, s)` columns expect strings, so we
 * keep them as strings until the DB side parses them).
 *
 * Without this, zod's `z.string()` accepts "abc" → parseFloat → NaN →
 * Postgres `numeric` rejects with a 500.
 */
export const numericString = z.string().regex(
  /^-?\d+(\.\d+)?$/,
  "must be a numeric string",
);

/** ISO date YYYY-MM-DD. Rejects bare year, slash dates, JS Date.toString. */
export const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
