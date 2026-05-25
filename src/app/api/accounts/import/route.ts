import { NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import Papa from "papaparse";
import {
  groupAccountsCsv,
  type AccountCsvInputRow,
} from "@/lib/import/group-accounts-csv";
import { parse, isValid } from "date-fns";
import { withAuth } from "@/lib/api/route-guards";

function parseDate(raw: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const formats = [
    "dd/MM/yyyy HH:mm:ss",
    "d/MM/yyyy HH:mm:ss",
    "dd/MM/yyyy",
    "d/MM/yyyy",
    "yyyy-MM-dd",
    "d MMM yyyy",
    "dd MMM yyyy",
  ];
  for (const fmt of formats) {
    const d = parse(raw.trim(), fmt, new Date());
    if (isValid(d)) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
  }
  return undefined;
}

function normaliseBalance(raw: string): string {
  const cleaned = raw.replace(/[$,\s]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? "0.00" : num.toFixed(2);
}

function mapAccountType(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("loan") || s.includes("mortgage")) return "loan";
  if (s.includes("credit") || s.includes("card")) return "credit";
  if (s.includes("sav")) return "savings";
  return "checking";
}

// Map BSB prefix → institution name
function bsbToInstitution(bsb: string): string | undefined {
  const digits = bsb.replace(/[-\s]/g, "");
  const prefix = digits.substring(0, 2);
  const map: Record<string, string> = {
    "01": "ANZ",
    "06": "CommBank",
    "03": "Westpac",
    "08": "NAB",
    "11": "St George",
    "73": "Bendigo Bank",
    "12": "Bank of Queensland",
    "33": "Macquarie",
    "19": "ING",
    "13": "Bankwest",
    "63": "Suncorp",
    "88": "HSBC",
    "92": "Citibank",
  };
  return map[prefix];
}

export interface PreviewAccount {
  name: string;
  type: string;
  institution?: string;
  accountNumberLast4?: string;
  startingBalance: string;
  startingDate?: string;
  isArchived: boolean;
  duplicate: boolean;
  /** Existing account id when duplicate is true. Commit treats this as an
   * update target rather than a new insert, so re-importing a bank export
   * refreshes the account's anchor balance. */
  existingId: string | null;
  /** Existing starting balance — shown in the preview row so the user can
   * see what they're about to overwrite. */
  existingBalance: string | null;
  /** True when the matched existing account was archived. Commit will
   * un-archive it on update (the CSV's presence is the user's signal
   * that the account is still in scope). Surfaced separately from
   * `duplicate` so the UI can show a "will un-archive" note if needed. */
  existingWasArchived: boolean;
  /** All (date, balance) pairs the bank gave us for this account during
   * the export period — Westpac and similar CSVs emit one row per
   * (account, date). The EARLIEST entry's balance is also reflected in
   * `startingBalance` above; the commit route persists the full series
   * into `bank_balances` for future running-balance reconciliation. ASC
   * by date. */
  balanceSeries: Array<{ date: string; balance: string }>;
  skip: boolean;
}

// Account-list CSVs are tiny — even hundreds of accounts fit in
// well under a megabyte. The 5 MB cap is a defence-in-depth limit
// against malicious / runaway uploads; legitimate files won't get
// close. Mirrors the backup restore route's `MAX_UPLOAD_BYTES`
// pattern (200 MB there, because backups can legitimately be
// large).
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const POST = withAuth(async (request) => {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_UPLOAD_BYTES} byte cap` },
      { status: 413 },
    );
  }

  const text = await file.text();
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (!result.data.length) {
    return NextResponse.json({ error: "No data rows found in CSV" }, { status: 400 });
  }

  const headers = Object.keys(result.data[0]);
  const findCol = (keyword: string) =>
    headers.find((h) => h.toLowerCase().includes(keyword.toLowerCase()));

  const colType = findCol("account type");
  const colName = findCol("nickname") ?? findCol("account name");
  const colBSB = findCol("bsb");
  const colAccNum = findCol("account number") ?? findCol("portfolio number");
  const colBalance = findCol("closing balance");
  const colBalDate = findCol("as at date");
  const colMarketValue = findCol("market value");
  const colOpenDate = findCol("opening date");
  const colCloseDate = findCol("closing date");

  // Load ALL existing accounts (including archived) for duplicate detection.
  // Re-importing a current bank export that includes a previously-archived
  // account is the user's signal that the account is back in scope — the
  // commit-side update path will flip `is_archived` back to false. Skipping
  // archived rows here was the cause of duplicate accounts being created
  // when a user re-imported a long-tail account that had been archived
  // earlier in the same household DB.
  const existing = await db.select().from(accounts);
  const existingByName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
  const existingByLast4 = new Map(
    existing.filter((a) => a.accountNumberLast4).map((a) => [a.accountNumberLast4!, a]),
  );

  // Westpac (and similar) export one CSV row per (account, date) with
  // that day's closing balance — so a 30-day export of 5 accounts is
  // 150 rows, not 5. Step 1: parse every row into a typed shape with
  // dates resolved. Step 2: hand them to `groupAccountsCsv` which
  // collapses by account-identity, anchors at the EARLIEST date, and
  // carries the full daily series.
  const parsedRows: AccountCsvInputRow[] = result.data.map((row) => {
    const name = (colName ? row[colName] : "").trim() || "Unnamed Account";
    const rawType = (colType ? row[colType] : "").trim();
    const bsb = (colBSB ? row[colBSB] : "").trim();
    const accNum = (colAccNum ? row[colAccNum] : "").trim();
    const rawBalance = (colBalance ? row[colBalance] : "").trim();
    const rawMarketValue = (colMarketValue ? row[colMarketValue] : "").trim();
    const rawBalDate = (colBalDate ? row[colBalDate] : "").trim();
    const rawOpenDate = (colOpenDate ? row[colOpenDate] : "").trim();
    const rawCloseDate = (colCloseDate ? row[colCloseDate] : "").trim();

    const accNumClean = accNum.replace(/[\s\-]/g, "");
    const accountNumberLast4 =
      accNumClean.length >= 4
        ? accNumClean.slice(-4)
        : accNumClean || undefined;

    let balance = normaliseBalance(rawBalance);
    const marketValue = normaliseBalance(rawMarketValue);
    if (parseFloat(balance) === 0 && parseFloat(marketValue) !== 0) {
      balance = marketValue;
    }

    return {
      name,
      type: mapAccountType(rawType),
      institution: bsbToInstitution(bsb),
      accountNumberLast4,
      startingBalance: balance,
      // Prefer the per-row "As at" snapshot date over the static
      // "Opening date" account-level metadata — the latter could be
      // years before the CSV's data window, so anchoring there would
      // claim the balance was correct from a date we have no txns for.
      startingDate: parseDate(rawBalDate) ?? parseDate(rawOpenDate),
      isArchived: !!parseDate(rawCloseDate),
    };
  });

  const grouped = groupAccountsCsv(parsedRows);

  const rows: PreviewAccount[] = grouped.map((g) => {
    const matched =
      existingByName.get(g.name.toLowerCase()) ??
      (g.accountNumberLast4
        ? existingByLast4.get(g.accountNumberLast4)
        : undefined);
    const duplicate = !!matched;

    return {
      name: g.name,
      type: g.type,
      institution: g.institution,
      accountNumberLast4: g.accountNumberLast4,
      startingBalance: g.startingBalance,
      startingDate: g.startingDate,
      isArchived: g.isArchived,
      duplicate,
      existingId: matched?.id ?? null,
      existingBalance: matched?.startingBalance ?? null,
      existingWasArchived: matched?.isArchived ?? false,
      balanceSeries: g.balanceSeries,
      // Keep duplicates checked so the import refreshes their balance by
      // default. The user can still uncheck individual rows.
      skip: false,
    };
  });

  return NextResponse.json({ rows });
});
