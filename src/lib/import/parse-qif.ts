import { parse, isValid } from "date-fns";
import { formatAmount } from "@/lib/utils";
import { newImportHash } from "./hash";
import { assignPostedSeq } from "./posted-seq";

export interface QIFAccountInfo {
  name?: string;
  type?: string;
  description?: string;
  balance?: string;
}

export interface QIFSplit {
  category?: string;
  memo?: string;
  amount?: string;
}

export interface ImportRow {
  date: string;
  amount: string;
  payee: string;
  description: string;
  rawId: string;
  importHash: string;
  duplicate?: boolean;
  postedAt?: string | null;
  postedSeq?: number | null;
  /** QIF-only enrichment. All optional and ignored by the production
   * import pipeline; surfaced in the import view so users can see what
   * the format actually carries (multi-account context, pre-categorised
   * hints, splits, etc.). */
  qifAccount?: QIFAccountInfo;
  /** The `!Type:` section header in effect for this row (e.g. "Bank",
   * "CCard", "Cash"). */
  qifSectionType?: string;
  /** N — check number / reference (QIF) or paper cheque number (OFX). */
  checkNum?: string;
  /** C — `*` cleared, `X` reconciled. QIF only. */
  cleared?: string;
  /** L — bank-supplied category hint, e.g. "Food:Groceries". QIF only. */
  bankCategory?: string;
  /** A — multi-line address. QIF only. */
  address?: string[];
  /** S/E/$ — split entries. QIF only. */
  splits?: QIFSplit[];
  /** OFX TRNTYPE. Cross-declared so consumers that handle either format
   * don't have to discriminate the row type. */
  trnType?: string;
  /** OFX REFNUM (bank reference number). Cross-declared, see above. */
  refNum?: string;
  /** CSV "Balance" column. Cross-declared, see above. */
  runningBalance?: string;
}

function parseQIFDate(raw: string): string {
  const formats = ["d/MM/yyyy", "dd/MM/yyyy", "M/d/yyyy", "MM/d/yyyy", "yyyy-MM-dd", "d-MM-yyyy"];
  for (const fmt of formats) {
    const d = parse(raw.trim().replace(/-/g, "/"), fmt, new Date());
    if (isValid(d)) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return raw.trim();
}

/**
 * QIF parser with account-context awareness.
 *
 * Multi-account QIFs alternate `!Account` blocks (defining an account) with
 * `!Type:Bank` / `!Type:CCard` sections (the transactions belonging to the
 * most-recently-defined account). Each row gets tagged with the account
 * context it was emitted under. Single-account QIFs (no `!Account` header)
 * still parse as before — the account context simply stays empty.
 *
 * Production callers (parse/commit routes) consume only date/amount/payee/
 * description/importHash and ignore the optional fields below.
 */
export function parseQIF(content: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const tupleCount = new Map<string, number>();

  type Mode = "header" | "account" | "transactions";
  let mode: Mode = "header";
  let currentAccount: QIFAccountInfo = {};
  let currentSection: string | undefined;
  let currentTxn: {
    date?: string;
    amount?: string;
    payee?: string;
    memo?: string;
    checkNum?: string;
    cleared?: string;
    category?: string;
    address?: string[];
    splits?: QIFSplit[];
    pendingSplit?: QIFSplit;
  } = {};

  function pushPendingSplit() {
    if (!currentTxn.pendingSplit) return;
    const s = currentTxn.pendingSplit;
    if (s.category != null || s.memo != null || s.amount != null) {
      currentTxn.splits = currentTxn.splits ?? [];
      currentTxn.splits.push(s);
    }
    currentTxn.pendingSplit = undefined;
  }

  function emitTxn() {
    pushPendingSplit();
    if (!currentTxn.date || !currentTxn.amount) {
      currentTxn = {};
      return;
    }
    const date = currentTxn.date;
    const amount = currentTxn.amount;
    // Literal `P` value, kept separate so it can drive a stable hash.
    const literalPayee = currentTxn.payee ?? "";
    const memo = currentTxn.memo ?? "";
    // Many AU banks (Westpac, NAB) emit only `M` (memo) and no `P` (payee).
    // OFX falls back from NAME to MEMO; mirror that here so the displayed
    // row has something useful and the trigram suggester has text to
    // match against.
    const displayPayee = literalPayee || memo;
    // Within-batch duplicate disambiguation — same tuple gets sequential
    // occurrence numbers so identical-looking rows still hash distinctly.
    // Use the LITERAL payee (not memo-fallback) so the rawId/tupleKey
    // shape matches the legacy parser exactly — pre-existing imports
    // continue to dedupe by importHash on re-import.
    const tupleKey = `${date}|${amount}|${literalPayee}`;
    const occurrence = tupleCount.get(tupleKey) ?? 0;
    tupleCount.set(tupleKey, occurrence + 1);
    const rawId = `qif-${date}-${amount}-${occurrence}`;
    const importHash = newImportHash({ date, amount, payee: literalPayee, rawId });
    rows.push({
      date,
      amount,
      payee: displayPayee,
      description: memo || displayPayee,
      rawId,
      importHash,
      qifAccount: currentAccount.name || currentAccount.type ? { ...currentAccount } : undefined,
      qifSectionType: currentSection,
      checkNum: currentTxn.checkNum,
      cleared: currentTxn.cleared,
      bankCategory: currentTxn.category,
      address: currentTxn.address?.length ? currentTxn.address : undefined,
      splits: currentTxn.splits?.length ? currentTxn.splits : undefined,
    });
    currentTxn = {};
  }

  function endOfEntry() {
    if (mode === "account") {
      // Finished defining an account; transactions for it follow once the
      // next `!Type:` line declares the section.
      mode = "header";
    } else if (mode === "transactions") {
      emitTxn();
    }
  }

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line) continue;

    if (line.startsWith("!Account")) {
      // If a transaction was mid-build (missing trailing `^`), flush it.
      endOfEntry();
      mode = "account";
      currentAccount = {};
      continue;
    }
    if (line.startsWith("!Type:")) {
      currentSection = line.slice("!Type:".length).trim();
      mode = "transactions";
      continue;
    }
    if (line.startsWith("!")) {
      // Other directives (e.g. `!Class`, `!Memorized`) — ignore.
      continue;
    }
    if (line === "^") {
      endOfEntry();
      continue;
    }

    // First data line in a file with no `!Account` / `!Type:` header
    // (legacy single-account form): assume transactions.
    if (mode === "header") mode = "transactions";

    const code = line[0];
    const value = line.slice(1).trim();

    if (mode === "account") {
      switch (code) {
        case "N": currentAccount.name = value; break;
        case "T": currentAccount.type = value; break;
        case "D": currentAccount.description = value; break;
        case "L": currentAccount.balance = value; break;
        // Other account fields (`/`, `$`) are ignored.
      }
      continue;
    }

    // Transaction mode
    switch (code) {
      case "D": currentTxn.date = parseQIFDate(value); break;
      case "T":
      case "U":
        currentTxn.amount = formatAmount(parseFloat(value.replace(/,/g, "")));
        break;
      case "P": currentTxn.payee = value; break;
      case "M": currentTxn.memo = value; break;
      case "N": currentTxn.checkNum = value; break;
      case "C": currentTxn.cleared = value; break;
      case "L": currentTxn.category = value; break;
      case "A":
        currentTxn.address = currentTxn.address ?? [];
        currentTxn.address.push(value);
        break;
      case "S":
        // Starting a new split — flush any in-flight one first.
        pushPendingSplit();
        currentTxn.pendingSplit = { category: value };
        break;
      case "E":
        currentTxn.pendingSplit = currentTxn.pendingSplit ?? {};
        currentTxn.pendingSplit.memo = value;
        break;
      case "$":
        currentTxn.pendingSplit = currentTxn.pendingSplit ?? {};
        currentTxn.pendingSplit.amount = formatAmount(parseFloat(value.replace(/,/g, "")));
        break;
    }
  }

  // Trailing flush in case the last entry has no `^` terminator.
  endOfEntry();

  assignPostedSeq(rows);
  return rows;
}
