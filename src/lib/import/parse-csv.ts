import Papa from "papaparse";
import { parse, isValid } from "date-fns";
import { newImportHash } from "./hash";
import { assignPostedSeq } from "./posted-seq";

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
  /** Optional CSV enrichment — surfaced in the import view so users can
   * compare what each format actually carries. Production parse + commit
   * routes ignore these fields. */
  qifAccount?: { name?: string; type?: string };
  qifSectionType?: string;
  bankCategory?: string;
  trnType?: string;
  refNum?: string;
  checkNum?: string;
  cleared?: string;
  address?: string[];
  splits?: { category?: string; memo?: string; amount?: string }[];
  /** Post-transaction running balance from a "Balance" column, when the
   * source CSV provides one. */
  runningBalance?: string;
}

type ParsedRow = Record<string, string>;

// Normalise AU date formats DD/MM/YYYY, YYYY-MM-DD, D/MM/YYYY
function parseDate(raw: string): string {
  const formats = ["dd/MM/yyyy", "d/MM/yyyy", "yyyy-MM-dd", "d MMM yyyy", "dd MMM yyyy"];
  for (const fmt of formats) {
    const d = parse(raw.trim(), fmt, new Date());
    if (isValid(d)) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return raw.trim();
}

function normaliseAmount(raw: string): string {
  // Remove currency symbols and commas
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? "0" : num.toFixed(2);
}

interface DetectedColumns {
  date: string;
  amount: string;
  debit?: string;
  credit?: string;
  description: string;
}

interface DetectedExtras {
  accountKey?: string;
  categoryKey?: string;
  refKey?: string;
  typeKey?: string;
  balanceKey?: string;
}

/** Return the original-case header for whichever lower-case name matches first. */
function findHeader(headers: string[], lower: string[], ...names: string[]): string | undefined {
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i !== -1) return headers[i];
  }
  return undefined;
}

// Detect Australian bank CSV column layout. Recognises:
//   - Westpac:  Bank Account, Date, Narrative, Debit Amount, Credit Amount, …
//   - CBA:      Date, Amount, Description, Balance
//   - ANZ:      Date, Amount, Details / Particulars
//   - NAB:      Date, Amount, Description (sometimes Debit/Credit split)
function detectColumns(headers: string[]): DetectedColumns | null {
  const lower = headers.map((x) => x.trim().toLowerCase());

  const date = findHeader(headers, lower, "date", "transaction date", "posting date");
  const description = findHeader(
    headers,
    lower,
    "description",
    "narrative",
    "details",
    "particulars",
    "memo",
    "transaction details",
  );
  const amount = findHeader(headers, lower, "amount", "transaction amount");
  const debit = findHeader(headers, lower, "debit amount", "debit", "withdrawal", "withdrawals");
  const credit = findHeader(headers, lower, "credit amount", "credit", "deposit", "deposits");

  if (!date) {
    // Generic fallback: assume first three columns are date / amount / desc.
    if (headers.length >= 3) {
      return { date: headers[0], amount: headers[1], description: headers[2] };
    }
    return null;
  }

  if (debit && credit && description) {
    return { date, amount: "", debit, credit, description };
  }

  if (amount && description) {
    return { date, amount, description };
  }

  // Last-resort: have date but neither pattern matched.
  if (headers.length >= 3) {
    return { date, amount: headers[1], description: headers[2] };
  }
  return null;
}

function detectExtras(headers: string[]): DetectedExtras {
  const lower = headers.map((x) => x.trim().toLowerCase());
  return {
    accountKey: findHeader(headers, lower, "bank account", "account", "account name", "account number"),
    categoryKey: findHeader(headers, lower, "category", "categories"),
    refKey: findHeader(headers, lower, "reference", "serial", "serial #", "serial number", "ref"),
    typeKey: findHeader(headers, lower, "type", "transaction type"),
    balanceKey: findHeader(headers, lower, "balance", "running balance"),
  };
}

export function parseCSV(content: string): ImportRow[] {
  const result = Papa.parse<ParsedRow>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length && !result.data.length) {
    throw new Error("Failed to parse CSV: " + result.errors[0].message);
  }

  if (!result.data.length) return [];

  const headers = Object.keys(result.data[0]);
  const cols = detectColumns(headers);
  if (!cols) throw new Error("Could not detect CSV column layout");
  const extras = detectExtras(headers);

  // Occurrence counter so two identical-looking CSV rows (same date, amount,
  // payee) get distinct hashes — without this, a $5 coffee shop visit twice
  // in one day would only import once. Counting by content (not file index)
  // keeps the rawId stable across re-imports of the same file. The account
  // identifier is part of the tuple key for multi-account CSVs so the same
  // date/amount/payee on two different accounts doesn't collide.
  const tupleCount = new Map<string, number>();
  const rows: ImportRow[] = result.data.map((row) => {
    const dateRaw = row[cols.date] ?? "";
    const date = parseDate(dateRaw);

    let amount: string;
    if (cols.debit !== undefined && cols.credit !== undefined) {
      const debit = parseFloat(row[cols.debit!]?.replace(/[$,\s]/g, "") || "0") || 0;
      const credit = parseFloat(row[cols.credit!]?.replace(/[$,\s]/g, "") || "0") || 0;
      amount = (credit - debit).toFixed(2);
    } else {
      amount = normaliseAmount(row[cols.amount] ?? "0");
    }

    const payee = (row[cols.description] ?? "").trim();
    const accountValue = extras.accountKey ? (row[extras.accountKey] ?? "").trim() : "";
    const tupleKey = `${accountValue}|${date}|${amount}|${payee}`;
    const occurrence = tupleCount.get(tupleKey) ?? 0;
    tupleCount.set(tupleKey, occurrence + 1);
    const rawId = `csv-${date}-${amount}-${occurrence}`;
    const importHash = newImportHash({ date, amount, payee, rawId });

    return {
      date,
      amount,
      payee,
      description: payee,
      rawId,
      importHash,
      qifAccount: accountValue ? { name: accountValue } : undefined,
      bankCategory: extras.categoryKey ? (row[extras.categoryKey] ?? "").trim() || undefined : undefined,
      refNum: extras.refKey ? (row[extras.refKey] ?? "").trim() || undefined : undefined,
      trnType: extras.typeKey ? (row[extras.typeKey] ?? "").trim() || undefined : undefined,
      runningBalance: extras.balanceKey ? (row[extras.balanceKey] ?? "").trim() || undefined : undefined,
    };
  });
  assignPostedSeq(rows);
  return rows;
}
