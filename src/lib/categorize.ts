import { db } from "@/db";
import { payeeRules, transactions } from "@/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { trigramSimilarity } from "@/lib/trigram";

const MONTHS_SHORT = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";
const MONTHS_LONG  = "JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER";

// Bank-imposed prefixes that say nothing about the merchant. Stripped
// before similarity matching so trigrams aren't burned on shared
// "DEBIT CARD PURCHASE …" boilerplate. Crucially we preserve the
// transfer-signalling tokens (TFR, PAYMENT after OSKO, TRANSFER after
// INTERNET) so the trigram engine can still pull historical transfers
// together — those tokens are how "money-moving" payees self-identify.
// Longest match wins so "DEBIT CARD PURCHASE" wins over "DEBIT".
const BANK_PREFIXES = [
  "DEBIT CARD PURCHASE",
  "PAYMENT BY AUTHORITY TO",
  "PAYMENT BY AUTHORITY",
  // Keep the trailing TFR if present.
  "DEPOSIT ONLINE",
  "WITHDRAWAL ONLINE",
  "DEPOSIT MOBILE",
  "WITHDRAWAL MOBILE",
  // Keep PAYMENT (Osko denoter).
  "DEPOSIT-OSKO",
  "WITHDRAWAL-OSKO",
  "EFTPOS DEBIT",
  "EFTPOS REFUND",
  // Keep TRANSFER.
  "INTERNET",
];
const BANK_PREFIX_RE = new RegExp(
  `^(?:${BANK_PREFIXES.map((p) => p.replace(/[\s-]/g, "[\\s-]+")).join("|")})\\s+`,
  "i",
);

export function normalizePayee(raw: string): string {
  return raw
    .trim()
    .replace(BANK_PREFIX_RE, "")
    // HTML entities
    .replace(/&amp;/gi, "&")
    // Foreign transaction fee block: "USD 11.00 INCL. FOREIGN TRANSACTION FEE AUD $0.46"
    .replace(/\s+[A-Z]{3}\s+[\d.]+\s+INCL\.?\s+FOREIGN\s+TRANSACTION\s+FEE\s+[A-Z]{3}\s+\$[\d.]+/gi, "")
    // "17-FEBRUARY-2026" or "17-FEB-2026" long-form dates
    .replace(new RegExp(`\\b\\d{1,2}-(?:${MONTHS_LONG}|${MONTHS_SHORT})-\\d{4}\\b`, "gi"), "")
    // "11 APR 2026" or "11 APR" short-form dates
    .replace(new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS_SHORT})(?:\\s+\\d{4})?\\b`, "gi"), "")
    // "26/04" or "26/04/24" slash dates
    .replace(/\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b/g, "")
    // standalone numeric refs of 5+ digits — bank txn IDs that change
    // every time, e.g. PayPal authorisation numbers.
    .replace(/\b\d{5,}\b/g, "")
    // (Trailing mixed-alphanumeric codes used to be stripped here too —
    // removed because that ate insurance policy numbers like
    // AAMI INSURANCE HPA029263300 and merged distinct policies into one
    // normalised key. Trigram similarity copes with the leftover noise.)
    // trailing country codes appended by bank: AUS, USA, GBR, NZL
    .replace(/\s+(?:AUS|USA|GBR|NZL|SGP)\s*$/i, "")
    // trailing backslashes (CSV truncation artifact)
    .replace(/[\\]+\s*$/, "")
    // trailing punctuation/hyphens left after stripping
    .replace(/[\s\-]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .toUpperCase();
}

export interface RuleRow {
  categoryId: string | null;
  minAmount: string | null;
  maxAmount: string | null;
}

// Exported for tests. The matcher's API uses `rangeContains` /
// `pickMostSpecific` indirectly via `batchLookupPayeeRules`, but the
// rule-resolution invariants are subtle enough to deserve direct
// regression coverage.
export function rangeContains(rule: RuleRow, amount: number): boolean {
  const min = rule.minAmount === null ? -Infinity : parseFloat(rule.minAmount);
  const max = rule.maxAmount === null ? Infinity : parseFloat(rule.maxAmount);
  return amount >= min && amount <= max;
}

// Smaller span = more specific. Unbounded sides count as infinite span so they
// always lose the tiebreaker against any bounded rule.
function ruleSpan(rule: RuleRow): number {
  if (rule.minAmount === null || rule.maxAmount === null) return Infinity;
  return parseFloat(rule.maxAmount) - parseFloat(rule.minAmount);
}

export function pickMostSpecific(rules: RuleRow[]): string | null {
  if (rules.length === 0) return null;
  let best: RuleRow | null = null;
  let bestSpan = Infinity;
  for (const r of rules) {
    if (!r.categoryId) continue;
    const span = ruleSpan(r);
    if (best === null || span < bestSpan) {
      best = r;
      bestSpan = span;
    }
  }
  return best?.categoryId ?? null;
}

/**
 * Resolve a payee → category, optionally filtered by amount.
 * When `amount` is provided, only rules whose [minAmount, maxAmount] range
 * contains the amount are considered, with the narrowest range winning.
 * When omitted, the unbounded rule (if any) is preferred.
 */
/**
 * History-based category suggester. Given a normalised payee + amount,
 * find the dominant category from previously-categorised transactions
 * with similar payees, using PostgreSQL's `pg_trgm` similarity. This is
 * the replacement for the old auto-derived range rules — instead of
 * fragmenting "PAYPAL" into a dozen point-rules, we let the categorised
 * history be the source of truth.
 *
 * Weighting:
 *   - similarity (≥ minSimilarity) is the primary signal.
 *   - amount-proximity (txns within 50% of `amount` get a small boost)
 *     handles bimodal payees like PayPal / Coles where small vs. large
 *     amounts hit different categories.
 *   - support count breaks ties so a category with 12 historical
 *     examples beats one with a single fluke.
 *
 * Returns null when nothing similar exists (or all candidates are below
 * the similarity floor).
 */
export interface CategorySuggestion {
  categoryId: string;
  /** 0..1 — confidence-ish, useful for the import preview to dim
   * low-certainty suggestions. */
  score: number;
  /** Number of historical transactions backing this suggestion. */
  support: number;
}

const SIMILARITY_FLOOR = 0.4;
const KNN_K = 10;
const AMOUNT_BAND_RATIO = 0.5;

/**
 * Pull a {token → frequency} map from the historical normalised payees.
 * The trigram match form drops "reference-shaped" tokens that appear only
 * once (per-transaction noise like HCFHEALTH's …S91WCCJY6 tail) but keeps
 * stable identifiers that recur across the corpus (AAMI policy numbers).
 */
export async function loadTokenFreq(): Promise<Map<string, number>> {
  const rows = await db
    .select({ normalizedPayee: transactions.normalizedPayee })
    .from(transactions)
    .where(isNotNull(transactions.normalizedPayee));
  const map = new Map<string, number>();
  for (const r of rows) {
    const np = r.normalizedPayee;
    if (!np) continue;
    for (const tok of np.split(/\s+/)) {
      if (!tok) continue;
      map.set(tok, (map.get(tok) ?? 0) + 1);
    }
  }
  return map;
}

/**
 * Drop per-transaction reference IDs. A token is stripped only when it
 * matches the reference shape (length ≥ 8, mixes letters and digits) AND
 * its corpus frequency is below 2 — so HCFHEALTH's noisy tail goes but
 * AAMI policy numbers (which recur every month) stay.
 */
export function deriveMatchPayee(
  normalizedPayee: string | null | undefined,
  freq: Map<string, number>,
): string | null {
  if (!normalizedPayee) return null;
  const kept = normalizedPayee
    .split(/\s+/)
    .filter((tok) => {
      if (!tok) return false;
      const isReferenceShaped =
        tok.length >= 8 && /\d/.test(tok) && /[A-Z]/.test(tok);
      if (!isReferenceShaped) return true;
      return (freq.get(tok) ?? 0) >= 2;
    })
    .join(" ")
    .trim();
  // Fall back to the full normalised form if everything was stripped — no
  // match form is worse than a noisy one.
  return kept.length > 0 ? kept : normalizedPayee;
}

/**
 * k-NN classifier over historical categorised transactions.
 *
 * Picks the top KNN_K nearest neighbours by trigram similarity (filtered to
 * those above SIMILARITY_FLOOR), then has them vote on category with
 * similarity-squared weighting. A small amount-band bonus lets bimodal
 * payees (PayPal small vs. PayPal big) tilt toward different categories.
 *
 * Why k-NN and not "GROUP BY category, ORDER BY avg_sim × ln(support)":
 * the broad categories (Dining Out, Groceries) tend to have many txns
 * whose payees share a "DEBIT CARD PURCHASE …" prefix and squeeze past
 * the similarity floor at ~0.45. Aggregating across all of them lets
 * support count dominate even when the actual closest matches are a
 * small handful of strong-similarity rows in a different category.
 * Capping at the closest K neighbours stops that.
 */
export interface SuggestCandidate {
  categoryId: string | null;
  matchPayee: string | null;
  amount: string;
}

export async function suggestCategoryByHistory(
  normalizedPayee: string,
  amount: number,
  freq?: Map<string, number>,
  /** Pre-fetched pool of categorised, payee-tagged rows. When supplied,
   *  skip the DB scan — critical for the bulk-categorise path in the
   *  import pipeline, where calling this function N times in a
   *  `Promise.all` was running N full table scans on `transactions`
   *  concurrently and OOM-killing the container on modest CSVs. The
   *  caller fetches the pool ONCE and shares it across every row. */
  preloadedCandidates?: ReadonlyArray<SuggestCandidate>,
): Promise<CategorySuggestion | null> {
  if (!normalizedPayee || normalizedPayee.length < 3) return null;
  // Compute a match form for the query using the same noise-stripping rule
  // applied to the historical match_payee column. Single-shot freq lookup
  // when the caller didn't pass one.
  const tokenFreq = freq ?? (await loadTokenFreq());
  const queryMatch = deriveMatchPayee(normalizedPayee, tokenFreq);
  if (!queryMatch) return null;
  // Compare against `ABS(amount)` in SQL so the band must use the magnitude
  // too — otherwise for an expense (amount = -50) lowAmt = -75 and highAmt
  // = -25, and `BETWEEN -75 AND -25` over a positive ABS column is always
  // empty. Result: amount-band weighting was dead code for every expense.
  const absAmount = Math.abs(amount);
  const lowAmt = absAmount * (1 - AMOUNT_BAND_RATIO);
  const highAmt = absAmount * (1 + AMOUNT_BAND_RATIO);
  // Pull every categorised, payee-tagged row once and score in JS. At
  // ~2.4k rows this is single-digit ms; the previous Postgres path used a
  // GIN trigram index but that's not portable to SQLite. Same scoring
  // shape: top-K neighbours by trigram similarity, k-NN vote weighted
  // by sim^2 and an amount-band boost.
  const candidates: ReadonlyArray<SuggestCandidate> =
    preloadedCandidates ??
    (await db
      .select({
        categoryId: transactions.categoryId,
        matchPayee: transactions.matchPayee,
        amount: transactions.amount,
      })
      .from(transactions)
      .where(
        and(
          isNotNull(transactions.categoryId),
          isNotNull(transactions.matchPayee),
        ),
      ));
  const scored: { categoryId: string; sim: number; amountMatch: number }[] = [];
  for (const c of candidates) {
    if (!c.categoryId || !c.matchPayee) continue;
    const sim = trigramSimilarity(c.matchPayee, queryMatch);
    if (sim <= SIMILARITY_FLOOR) continue;
    const tAbs = Math.abs(parseFloat(c.amount));
    const amountMatch = tAbs >= lowAmt && tAbs <= highAmt ? 1.0 : 0.0;
    scored.push({ categoryId: c.categoryId, sim, amountMatch });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.sim - a.sim);
  const neighbours = scored.slice(0, KNN_K);

  // Amount-band weighting: in-band rows get ×1.4, out-of-band ×0.6
  // (factor 2.33 between them). When the trigram match is identical
  // across categories — same merchant, different amount profile (JB
  // HI-FI Nunawading: small purchases categorised Equipment, larger
  // ones Gifts) — amount is the primary disambiguator.
  const byCat = new Map<
    string,
    { score: number; sumSim: number; support: number }
  >();
  for (const n of neighbours) {
    const w = n.sim * n.sim * (0.6 + 0.8 * n.amountMatch);
    const cur = byCat.get(n.categoryId) ?? { score: 0, sumSim: 0, support: 0 };
    cur.score += w;
    cur.sumSim += n.sim;
    cur.support += 1;
    byCat.set(n.categoryId, cur);
  }
  let bestCatId: string | null = null;
  let bestEntry: { score: number; sumSim: number; support: number } | null = null;
  for (const [catId, entry] of byCat) {
    const candAvg = entry.sumSim / entry.support;
    const bestAvg = bestEntry ? bestEntry.sumSim / bestEntry.support : -Infinity;
    if (
      bestEntry === null ||
      entry.score > bestEntry.score ||
      (entry.score === bestEntry.score && candAvg > bestAvg)
    ) {
      bestCatId = catId;
      bestEntry = entry;
    }
  }
  if (!bestCatId || !bestEntry) return null;
  return {
    categoryId: bestCatId,
    score: Math.min(1, bestEntry.sumSim / bestEntry.support),
    support: bestEntry.support,
  };
}

/**
 * Per-row batch lookup. Returns a map keyed by `item.key` so callers can
 * carry through their own row identifier (e.g. `importHash`). Resolves
 * each row's (normalizedPayee, amount) tuple against the payee_rules
 * table, picking the most-specific overlapping rule per row.
 */
export async function batchLookupPayeeRules(
  items: { key: string; normalizedPayee: string; amount: number }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (items.length === 0) return result;

  const uniquePayees = Array.from(new Set(items.map((i) => i.normalizedPayee))).filter(Boolean);
  if (uniquePayees.length === 0) return result;

  const rules = await db
    .select({
      normalizedPayee: payeeRules.normalizedPayee,
      categoryId: payeeRules.categoryId,
      minAmount: payeeRules.minAmount,
      maxAmount: payeeRules.maxAmount,
    })
    .from(payeeRules)
    .where(inArray(payeeRules.normalizedPayee, uniquePayees));

  const byPayee = new Map<string, RuleRow[]>();
  for (const r of rules) {
    const arr = byPayee.get(r.normalizedPayee) ?? [];
    arr.push(r);
    byPayee.set(r.normalizedPayee, arr);
  }

  for (const item of items) {
    const candidates = byPayee.get(item.normalizedPayee);
    if (!candidates || candidates.length === 0) continue;
    const matched = candidates.filter((r) => rangeContains(r, item.amount));
    const catId = pickMostSpecific(matched);
    if (catId) result.set(item.key, catId);
  }
  return result;
}

// Categorisation runs entirely against local data (rules + trigram
// suggester). The AI fallback that used to live here was removed —
// the trigram engine reads the categorised history directly, so no
// payee strings ever leave the box.
