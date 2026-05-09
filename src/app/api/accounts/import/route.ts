import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import Papa from "papaparse";
import { parse, isValid } from "date-fns";

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
  skip: boolean;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

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

  // Load existing accounts for duplicate detection. Build lookup maps keyed
  // by name and last-4 so duplicates can be turned into updates rather than
  // skips — re-importing the same bank export then refreshes the balance.
  const existing = await db.select().from(accounts).where(eq(accounts.isArchived, false));
  const existingByName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
  const existingByLast4 = new Map(
    existing.filter((a) => a.accountNumberLast4).map((a) => [a.accountNumberLast4!, a]),
  );

  const rows: PreviewAccount[] = result.data.map((row) => {
    const name = (colName ? row[colName] : "").trim() || "Unnamed Account";
    const rawType = (colType ? row[colType] : "").trim();
    const bsb = (colBSB ? row[colBSB] : "").trim();
    const accNum = (colAccNum ? row[colAccNum] : "").trim();
    const rawBalance = (colBalance ? row[colBalance] : "").trim();
    const rawMarketValue = (colMarketValue ? row[colMarketValue] : "").trim();
    const rawBalDate = (colBalDate ? row[colBalDate] : "").trim();
    const rawOpenDate = (colOpenDate ? row[colOpenDate] : "").trim();
    const rawCloseDate = (colCloseDate ? row[colCloseDate] : "").trim();

    const type = mapAccountType(rawType);
    const institution = bsbToInstitution(bsb);

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

    const startingDate = parseDate(rawBalDate) ?? parseDate(rawOpenDate);
    const isArchived = !!parseDate(rawCloseDate);

    const matched =
      existingByName.get(name.toLowerCase()) ??
      (accountNumberLast4 ? existingByLast4.get(accountNumberLast4) : undefined);
    const duplicate = !!matched;

    return {
      name,
      type,
      institution,
      accountNumberLast4,
      startingBalance: balance,
      startingDate,
      isArchived,
      duplicate,
      existingId: matched?.id ?? null,
      existingBalance: matched?.startingBalance ?? null,
      // Keep duplicates checked so the import refreshes their balance by
      // default. The user can still uncheck individual rows.
      skip: false,
    };
  });

  return NextResponse.json({ rows });
}
