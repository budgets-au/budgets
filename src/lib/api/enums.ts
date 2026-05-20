import { z } from "zod";

/** Shape-validation enums shared across API routes. Centralised so
 *  the single source of truth lives next to the helpers, not in
 *  half a dozen route files. The DB schema's own column types
 *  remain free-form text — only the API edge bothers enforcing
 *  the closed set. */

/** Account "type" — drives the sidebar grouping, the type
 *  picker, and the asset-vs-liability sign convention. */
export const accountTypeEnum = z.enum([
  "checking",
  "savings",
  "credit",
  "loan",
  "cash",
]);
export type AccountType = z.infer<typeof accountTypeEnum>;

/** Category `transfer_kind` — `"internal"` for asset-to-asset
 *  moves (net to zero on the report rollup), `"external"` for
 *  things like CC payoffs to outside banks (real outflow),
 *  `"none"` for the default non-transfer case. */
export const transferKindEnum = z.enum(["none", "internal", "external"]);
export type TransferKind = z.infer<typeof transferKindEnum>;
