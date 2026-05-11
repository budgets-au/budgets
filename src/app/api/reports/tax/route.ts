import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { appSettings, categories, transactions } from "@/db/schema";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { TaxConfig } from "@/db/schema";
import { calculateTaxReport, type TaxReport } from "@/lib/tax/calc";
import { currentFyEndYear, fyDateRange } from "@/lib/tax/fy";

export type { TaxReport };

const EMPTY_TAX_CONFIG: TaxConfig = { wfhHoursByFy: {}, categoryRules: {} };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const fyEndYearRaw = searchParams.get("fyEndYear");
  const fyEndYear = fyEndYearRaw ? parseInt(fyEndYearRaw, 10) : currentFyEndYear();
  if (!Number.isInteger(fyEndYear) || fyEndYear < 1990 || fyEndYear > 2100) {
    return NextResponse.json({ error: "Invalid fyEndYear" }, { status: 400 });
  }
  const fyRange = fyDateRange(fyEndYear);

  // accountIds — comma-separated UUIDs; same UUID-shape guard cashflow uses.
  const accountIdsRaw = searchParams.get("accountIds");
  const accountIds = (accountIdsRaw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => UUID_RE.test(id));

  const [settings] = await db
    .select({ taxConfig: appSettings.taxConfig })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);
  const config: TaxConfig = settings?.taxConfig ?? EMPTY_TAX_CONFIG;

  // FY-scoped expense-category transactions, transfers always excluded —
  // transfers are never deductible regardless of the global hideTransfers
  // toggle. Pull just amount + categoryId; calc handles the aggregation.
  const txnConditions = [
    gte(transactions.date, fyRange.from),
    lte(transactions.date, fyRange.to),
    ne(categories.transferKind, "internal"),
    eq(categories.type, "expense"),
  ];
  if (accountIds.length > 0) {
    txnConditions.push(inArray(transactions.accountId, accountIds));
  }
  const txnRows = await db
    .select({ amount: transactions.amount, categoryId: transactions.categoryId })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(and(...txnConditions));

  const catRows = await db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories);

  const report = calculateTaxReport({
    fyEndYear,
    fyRange,
    config,
    categories: catRows,
    txns: txnRows.map((r) => ({ amount: parseFloat(r.amount), categoryId: r.categoryId ?? "" })),
  });

  return NextResponse.json(report);
}
