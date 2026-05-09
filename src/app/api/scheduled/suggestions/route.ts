import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  transactions,
  accounts,
  scheduledTransactions,
  categories,
  scheduleSuggestionDismissals,
} from "@/db/schema";
import { eq, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { subMonths, format } from "date-fns";
import { normalizePayee } from "@/lib/categorize";

// 24 months covers two yearly observations and three quarterly. Cheap enough
// at household scale; the matcher in JS is the bottleneck, not the query.
const LOOKBACK_MONTHS = 24;
// Default min: three observations rule out one-off charges. Yearly is special-
// cased lower because two yearly hits inside the 24-month window is the most
// you'll ever get for an actually-yearly pattern.
const MIN_OCCURRENCES = 3;
const MIN_OCCURRENCES_YEARLY = 2;
// Fraction of gaps that must fit the cadence (incl. its 2× "skipped occurrence"
// neighbour). Lowered from 0.6 → 0.5 so a single anomalous gap doesn't reject
// an otherwise-clean pattern.
const CONSISTENCY_THRESHOLD = 0.5;

interface FrequencyDef {
  frequency: "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";
  days: number;
  tolerance: number;
}

// Tolerances widened across the board. Banks shift on weekends/holidays, and
// monthly bills tied to the 28th–31st routinely drift by a few days.
const FREQUENCIES: FrequencyDef[] = [
  { frequency: "weekly",      days: 7,   tolerance: 3 },
  { frequency: "fortnightly", days: 14,  tolerance: 4 },
  { frequency: "monthly",     days: 30,  tolerance: 7 },
  { frequency: "quarterly",   days: 91,  tolerance: 15 },
  { frequency: "yearly",      days: 365, tolerance: 30 },
];

function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// A gap "fits" a target cadence (in days) if it's within tolerance of either
// the target or 2× the target (a single missed occurrence). 3× is too
// forgiving and starts confusing weekly with fortnightly.
function gapFitsTarget(gap: number, target: number, tolerance: number): boolean {
  if (Math.abs(gap - target) <= tolerance) return true;
  if (Math.abs(gap - 2 * target) <= tolerance) return true;
  return false;
}

interface DetectedCadence {
  frequency: FrequencyDef["frequency"];
  interval: number;
  target: number;     // f.days * interval — the per-occurrence cadence in days
  tolerance: number;  // scaled by sqrt(interval); gap variance grows absolutely, not proportionally
}

function detectFrequency(gaps: number[]): DetectedCadence | null {
  if (gaps.length === 0) return null;
  const med = median(gaps);
  // interval-OUTER so interval=1 wins for every base cadence before any
  // interval=2 is tried — a 14-day median resolves to (fortnightly, 1), not
  // (weekly, 2). Bills like Origin gas (~60 days) fall through interval=1
  // entirely and pick up at (monthly, 2).
  for (const interval of [1, 2, 3]) {
    for (const f of FREQUENCIES) {
      const target = f.days * interval;
      const tol = f.tolerance * Math.sqrt(interval);
      if (Math.abs(med - target) > tol) continue;
      const fits = gaps.filter((g) => gapFitsTarget(g, target, tol)).length;
      if (fits / gaps.length >= CONSISTENCY_THRESHOLD) {
        return { frequency: f.frequency, interval, target, tolerance: tol };
      }
    }
  }
  return null;
}

interface Suggestion {
  // Stable composite key the client can use to identify the suggestion
  // (e.g. for dismiss-after-add UX).
  key: string;
  accountId: string;
  accountName: string;
  accountColor: string;
  payee: string;
  normalizedPayee: string;
  amount: string;          // signed; for range patterns this is the observed maximum
  // Lower bound when the pattern's amount varies enough to warrant a
  // range-mode schedule. Null for stable single-amount patterns.
  amountMin: string | null;
  isRange: boolean;
  frequency: FrequencyDef["frequency"];
  interval: number;
  count: number;
  firstDate: string;
  lastDate: string;
  suggestedStartDate: string; // best guess: lastDate + cadence (next occurrence)
  categoryId: string | null;
  categoryName: string | null;
  alreadyScheduled: boolean;
  // Confidence: fraction of gaps within cadence tolerance, plus amount stability
  confidence: number;
  // True when the user has dismissed this suggestion. Hidden by default;
  // shown behind a "Show N dismissed" toggle.
  dismissed: boolean;
  // "transfer" when the underlying transactions are paired transfers; the
  // panel uses this to set the schedule's type when the user clicks Add and
  // to render a destination-account badge.
  type: "expense" | "income" | "transfer";
  transferToAccountId: string | null;
  transferToAccountName: string | null;
  transferToAccountColor: string | null;
  // The actual historical transactions that drove the detection. Surfaces a
  // "matched transactions" preview in the UI without a second fetch.
  observations: Array<{
    id: string;
    date: string;
    amount: string;
    payee: string | null;
    categoryName: string | null;
  }>;
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = format(subMonths(new Date(), LOOKBACK_MONTHS), "yyyy-MM-dd");

  // Pull transactions in the lookback window. We INCLUDE rows with transfer
  // pairs now — pattern detection over scheduled transfers is just as useful
  // as over expenses/income, and the engine emits them as transfer-type
  // suggestions with the destination account inferred from the pair link.
  const pairTxn = alias(transactions, "pair_txn");
  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      payee: transactions.payee,
      accountId: transactions.accountId,
      accountName: accounts.name,
      accountColor: accounts.color,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      transferPairId: transactions.transferPairId,
      pairAccountId: pairTxn.accountId,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .leftJoin(pairTxn, eq(transactions.transferPairId, pairTxn.id))
    .where(gte(transactions.date, since));

  // Group by (accountId + normalizedPayee). Same payee on different accounts
  // is genuinely two different recurrences (e.g. a couple's joint Netflix on
  // both cards).
  type GroupRow = (typeof rows)[number] & { normalizedPayee: string };
  const groups = new Map<string, GroupRow[]>();
  for (const r of rows) {
    if (!r.payee) continue;
    const normalized = normalizePayee(r.payee);
    if (!normalized) continue;
    const key = `${r.accountId}#${normalized}`;
    const arr = groups.get(key) ?? [];
    arr.push({ ...r, normalizedPayee: normalized });
    groups.set(key, arr);
  }

  // Existing schedules — used to flag suggestions already covered. Bank
  // payees are noisier than user-typed schedule payees (e.g. the bank reports
  // "SALARY DEPOSIT FROM EMPLOYER LTD 1234" while the user's schedule is
  // simply "Salary"), so an equality check on normalized strings produces
  // false negatives. We do a containment check both ways: either side
  // appearing as a substring of the other counts as the same payee, provided
  // the shorter side is at least 3 chars (avoids "AB" matching everything).
  const existing = await db
    .select({
      accountId: scheduledTransactions.accountId,
      payee: scheduledTransactions.payee,
      amount: scheduledTransactions.amount,
      amountMin: scheduledTransactions.amountMin,
      frequency: scheduledTransactions.frequency,
      interval: scheduledTransactions.interval,
      type: scheduledTransactions.type,
      categoryId: scheduledTransactions.categoryId,
      transferToAccountId: scheduledTransactions.transferToAccountId,
      isActive: scheduledTransactions.isActive,
    })
    .from(scheduledTransactions);
  const activeRules = existing
    .filter((e) => e.isActive)
    .map((e) => ({ ...e, normPayee: normalizePayee(e.payee ?? "") }));

  // User-dismissed suggestions. We still emit them in the response (with
  // dismissed: true) so the UI can offer a "show dismissed" toggle without
  // needing a second round-trip.
  const dismissalRows = await db
    .select({
      accountId: scheduleSuggestionDismissals.accountId,
      normalizedPayee: scheduleSuggestionDismissals.normalizedPayee,
    })
    .from(scheduleSuggestionDismissals);
  const dismissedKeys = new Set(
    dismissalRows.map((d) => `${d.accountId}#${d.normalizedPayee}`),
  );

  // Lookup map for hydrating the destination-account badge on transfer rows.
  const accountList = await db
    .select({ id: accounts.id, name: accounts.name, color: accounts.color })
    .from(accounts);
  const accountById = new Map(accountList.map((a) => [a.id, a]));

  const suggestions: Suggestion[] = [];

  for (const [key, items] of groups) {
    // Provisional gate: yearly only needs 2 hits (you can't get 3 yearly
    // observations inside a 24-month window). Everything else still wants 3.
    if (items.length < MIN_OCCURRENCES_YEARLY) continue;

    // Detect whether this group represents a transfer pattern: most rows have
    // a transferPairId. If so, classify; otherwise expense/income by amount.
    const pairedCount = items.filter((r) => r.transferPairId).length;
    const isTransferPattern = pairedCount / items.length >= 0.5;
    let suggestionType: "expense" | "income" | "transfer";
    let transferDestAccountId: string | null = null;
    if (isTransferPattern) {
      // Convention: emit only the source leg (negative amount). The matching
      // destination-leg group will be skipped here so the user sees a single
      // suggestion per transfer, not two.
      const positiveCount = items.filter((r) => parseFloat(r.amount) > 0).length;
      if (positiveCount > items.length / 2) continue; // destination leg
      suggestionType = "transfer";
      // Pick the most common destination account from the pair links.
      const destCounts = new Map<string, number>();
      for (const r of items) {
        if (r.pairAccountId) {
          destCounts.set(r.pairAccountId, (destCounts.get(r.pairAccountId) ?? 0) + 1);
        }
      }
      let bestDest: string | null = null;
      let bestN = 0;
      for (const [acct, n] of destCounts) {
        if (n > bestN) { bestN = n; bestDest = acct; }
      }
      transferDestAccountId = bestDest;
    } else {
      // Average sign decides expense vs income.
      const negCount = items.filter((r) => parseFloat(r.amount) < 0).length;
      suggestionType = negCount > items.length / 2 ? "expense" : "income";
    }

    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const gaps: number[] = [];
    for (let i = 1; i < items.length; i++) {
      gaps.push(diffDays(items[i].date, items[i - 1].date));
    }

    const freq = detectFrequency(gaps);
    if (!freq) continue;

    // Final occurrence-count gate, now that we know the cadence.
    const minRequired = freq.frequency === "yearly" ? MIN_OCCURRENCES_YEARLY : MIN_OCCURRENCES;
    if (items.length < minRequired) continue;

    const amounts = items.map((r) => parseFloat(r.amount));
    const medAmount = median(amounts);
    const absAmounts = amounts.map(Math.abs);
    const minAbs = Math.min(...absAmounts);
    const maxAbs = Math.max(...absAmounts);
    // Amount stability: how tightly amounts cluster around the median.
    // Within-10% counts as stable; full deviation is the average absolute
    // distance from the median, normalised against the median.
    const meanAbsDev = amounts.reduce((sum, a) => sum + Math.abs(a - medAmount), 0) / amounts.length;
    const amountStability = medAmount === 0 ? 0 : Math.max(0, 1 - meanAbsDev / Math.abs(medAmount));

    // Variable-amount bills (utilities, energy) should surface as range-mode
    // suggestions: the user accepts them as a schedule with amount_min set,
    // forecasting uses the max, and matching accepts anything in the band.
    // Stability < 0.7 ≈ mean absolute deviation > 30% of |median|.
    const isRange = amountStability < 0.7;
    // Sign convention: keep the sign of the median so expense rows stay
    // negative. Magnitudes carry the band.
    const signedMax = medAmount >= 0 ? maxAbs : -maxAbs;
    const reportedAmount = (isRange ? signedMax : medAmount).toFixed(2);
    const reportedAmountMin = isRange ? minAbs.toFixed(2) : null;

    // Cadence confidence uses freq's interval-aware target/tolerance.
    const cadenceConfidence = gaps.filter((g) => gapFitsTarget(g, freq.target, freq.tolerance)).length / gaps.length;
    // For range patterns, variability is the *point* of the mode rather than a
    // defect — confidence is just cadence consistency.
    const confidence = isRange
      ? Math.min(1, cadenceConfidence)
      : Math.min(1, cadenceConfidence * 0.7 + amountStability * 0.3);

    // Suggested start: project one cadence forward from the last seen date so
    // the new schedule starts capturing the next occurrence rather than
    // re-inserting old ones.
    const lastDate = items[items.length - 1].date;
    const suggestedStart = new Date(`${lastDate}T00:00:00Z`);
    suggestedStart.setUTCDate(suggestedStart.getUTCDate() + freq.target);

    const candidatePayee = items[0].normalizedPayee;

    // Pick the most-recently-used category for the prefilled categoryId. If
    // the past transactions disagree we go with the most-frequent. Computed
    // here (not where it lived before) so the alreadyScheduled check below
    // can use it as a fallback signal when payee text was renamed.
    const catCounts = new Map<string, number>();
    let displayCategoryName: string | null = null;
    for (const r of items) {
      if (!r.categoryId) continue;
      catCounts.set(r.categoryId, (catCounts.get(r.categoryId) ?? 0) + 1);
      if (!displayCategoryName) displayCategoryName = r.categoryName ?? null;
    }
    let chosenCategoryId: string | null = null;
    let bestCount = 0;
    for (const [id, n] of catCounts) {
      if (n > bestCount) {
        bestCount = n;
        chosenCategoryId = id;
        const matchingRow = items.find((r) => r.categoryId === id);
        displayCategoryName = matchingRow?.categoryName ?? displayCategoryName;
      }
    }

    // Already-scheduled detection. The user might have renamed the schedule's
    // payee to something more readable (so the substring match falls through),
    // so we ALSO accept a match on (account + frequency + interval + amount
    // band overlap + category). The amount check uses band overlap (±20%
    // schedule fudge) so a range-mode schedule covers a range suggestion and
    // vice versa.
    const sugMin = isRange ? minAbs : Math.abs(medAmount);
    const sugMax = isRange ? maxAbs : Math.abs(medAmount);
    const alreadyScheduled = activeRules.some((r) => {
      if (r.accountId !== items[0].accountId) return false;
      if (r.frequency !== freq.frequency) return false;
      if ((r.interval ?? 1) !== freq.interval) return false;
      // A transfer suggestion shouldn't be considered "already scheduled" by
      // a same-payee expense rule, and vice versa — they're different intents.
      if (r.type === "transfer" && suggestionType !== "transfer") return false;
      if (r.type !== "transfer" && suggestionType === "transfer") return false;
      // For transfers, also require the destination accounts to match.
      if (
        suggestionType === "transfer" &&
        transferDestAccountId &&
        r.transferToAccountId &&
        r.transferToAccountId !== transferDestAccountId
      ) {
        return false;
      }
      // Band overlap: schedule's [amountMin or amount, amount] vs suggestion's
      // [min, max]. Add ±20% tolerance to the schedule's bounds for fuzz.
      const ruleAbs = Math.abs(parseFloat(r.amount));
      const ruleAmtTol = Math.max(1, ruleAbs * 0.2);
      const ruleMin = (r.amountMin != null ? Math.abs(parseFloat(r.amountMin)) : ruleAbs) - ruleAmtTol;
      const ruleMax = ruleAbs + ruleAmtTol;
      if (ruleMax < sugMin || sugMax < ruleMin) return false;

      // Match A: payee substring (in either direction; shorter side ≥ 3 chars
      // to avoid a 2-char schedule payee soaking up unrelated suggestions).
      if (r.normPayee.length > 0) {
        const a = candidatePayee;
        const b = r.normPayee;
        const shorter = a.length <= b.length ? a : b;
        const longer = shorter === a ? b : a;
        if (shorter.length >= 3 && longer.includes(shorter)) return true;
      }

      // Match B: same category. Catches the case where the user renamed the
      // schedule's payee to something readable that no longer substrings the
      // bank statement text.
      if (r.categoryId && chosenCategoryId && r.categoryId === chosenCategoryId) {
        return true;
      }

      return false;
    });

    const destAcct = transferDestAccountId ? accountById.get(transferDestAccountId) : null;
    suggestions.push({
      key,
      accountId: items[0].accountId,
      accountName: items[0].accountName ?? "",
      accountColor: items[0].accountColor ?? "#94a3b8",
      payee: items[items.length - 1].payee ?? items[0].payee ?? "",
      normalizedPayee: items[0].normalizedPayee,
      amount: reportedAmount,
      amountMin: reportedAmountMin,
      isRange,
      frequency: freq.frequency,
      interval: freq.interval,
      count: items.length,
      firstDate: items[0].date,
      lastDate,
      suggestedStartDate: suggestedStart.toISOString().slice(0, 10),
      categoryId: suggestionType === "transfer" ? null : chosenCategoryId,
      categoryName: suggestionType === "transfer" ? null : displayCategoryName,
      alreadyScheduled,
      confidence,
      dismissed: dismissedKeys.has(key),
      type: suggestionType,
      transferToAccountId: transferDestAccountId,
      transferToAccountName: destAcct?.name ?? null,
      transferToAccountColor: destAcct?.color ?? null,
      observations: items
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((r) => ({
          id: r.id,
          date: r.date,
          amount: r.amount,
          payee: r.payee,
          categoryName: r.categoryName,
        })),
    });
  }

  suggestions.sort((a, b) => {
    // Dismissed → bottom, then already-scheduled → near-bottom, then by
    // confidence/count for the actionable rows the user actually cares about.
    if (a.dismissed !== b.dismissed) return a.dismissed ? 1 : -1;
    if (a.alreadyScheduled !== b.alreadyScheduled) return a.alreadyScheduled ? 1 : -1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.count - a.count;
  });

  return NextResponse.json(suggestions);
}
