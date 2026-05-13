import { formatAmount } from "@/lib/utils";
import { newImportHash } from "./hash";
import { assignPostedSeq } from "./posted-seq";

export interface OFXBalance {
  amount: string;
  asOf: string | null;
}

export interface OFXMeta {
  institution?: string;
  accountId?: string;
  accountType?: string;
  /** OFX-only enrichment fields. Currently only consumed by the
   * import view so users can see what extra data the format carries
   * beyond date/amount/payee. The production parse + commit path ignores
   * them. */
  bankId?: string;
  currency?: string;
  statementStart?: string;
  statementEnd?: string;
  ledgerBalance?: OFXBalance;
  availableBalance?: OFXBalance;
}

export interface ImportRow {
  date: string;
  amount: string;
  payee: string;
  description: string;
  rawId: string;
  importHash: string;
  duplicate?: boolean;
  /** Full DTPOSTED timestamp as ISO 8601 when the OFX includes a time
   * component. Null for CSV/QIF imports and for OFX rows that only had a
   * date. */
  postedAt?: string | null;
  /** Position of the row in the source file (0 = first). The matcher uses
   * this as a tiebreaker so rows that share a day still display in the
   * bank's order. */
  postedSeq?: number | null;
  /** TRNTYPE — CREDIT/DEBIT/INT/DIV/FEE/SRVCHG/DEP/ATM/POS/XFER/CHECK/
   * PAYMENT/CASH/DIRECTDEP/DIRECTDEBIT/REPEATPMT/HOLD/OTHER. */
  trnType?: string;
  /** CHECKNUM — paper cheque number. */
  checkNum?: string;
  /** REFNUM — bank reference number; can deduplicate beyond FITID. */
  refNum?: string;
  /** Cross-declared from the QIF type so consumers that accept either
   * format's row don't have to discriminate. Never populated by parseOFX. */
  qifAccount?: { name?: string; type?: string; description?: string; balance?: string };
  qifSectionType?: string;
  cleared?: string;
  bankCategory?: string;
  address?: string[];
  splits?: { category?: string; memo?: string; amount?: string }[];
  runningBalance?: string;
}

function extractTag(content: string, tag: string): string | undefined {
  // Handle both SGML (<TAG>value) and XML (<TAG>value</TAG>) OFX formats
  const xmlMatch = content.match(new RegExp(`<${tag}>([^<]+)<\/${tag}>`, "i"));
  if (xmlMatch) return xmlMatch[1].trim();
  const sgmlMatch = content.match(new RegExp(`<${tag}>([^\r\n<]+)`, "i"));
  if (sgmlMatch) return sgmlMatch[1].trim();
  return undefined;
}

/** Extract the contents of a nested block like `<LEDGERBAL>…</LEDGERBAL>`.
 * Tries the XML form first; for SGML emitters that omit the closing tag,
 * falls back to a bounded scan from the opening tag — long enough to span
 * the typical 2–3 sub-tags inside but capped so we don't slurp the next
 * sibling block. */
function extractBlock(content: string, tag: string): string | undefined {
  const xml = content.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  if (xml) return xml[1];
  const idx = content.search(new RegExp(`<${tag}>`, "i"));
  if (idx === -1) return undefined;
  const start = idx + tag.length + 2;
  return content.slice(start, start + 400);
}

function parseOFXDate(raw: string): string {
  // OFX dates: YYYYMMDDHHMMSS[.XXX][+OFFSET] or YYYYMMDD
  const clean = raw.replace(/\[.*\]/, "").slice(0, 8);
  const y = clean.slice(0, 4);
  const m = clean.slice(4, 6);
  const d = clean.slice(6, 8);
  return `${y}-${m}-${d}`;
}

/**
 * Pull the full timestamp out of an OFX DTPOSTED value. The format spec is
 * YYYYMMDDHHMMSS[.XXX][+OFFSET] (where OFFSET is `[hours[:minutes]:TZNAME]`
 * — the Australian banks usually emit `[+10:EST]` or just `+1100`).
 *
 * Returns null when the value is just a date or unparseable; the caller
 * falls back to using the date plus a per-file sequence number for ordering.
 */
function parseOFXTimestamp(raw: string): string | null {
  // Strip a bracketed timezone hint like "[+10:EST]" first; it's not part
  // of ISO 8601, but the digits before it usually are.
  const tzMatch = raw.match(/\[([+-]?\d+(?::\d+)?)(?::[A-Z]+)?\]/);
  const tzFromBracket = tzMatch ? tzMatch[1] : null;
  const trimmed = raw.replace(/\[.*?\]/, "").trim();
  if (trimmed.length < 14) return null;
  const y = trimmed.slice(0, 4);
  const m = trimmed.slice(4, 6);
  const d = trimmed.slice(6, 8);
  const hh = trimmed.slice(8, 10);
  const mm = trimmed.slice(10, 12);
  const ss = trimmed.slice(12, 14);
  let suffix = trimmed.slice(14);
  let msPart = "";
  const msMatch = suffix.match(/^\.(\d+)/);
  if (msMatch) {
    msPart = `.${msMatch[1].slice(0, 3).padEnd(3, "0")}`;
    suffix = suffix.slice(msMatch[0].length);
  }
  // Inline timezone (`+0500`, `+05:00`, `Z`) wins over the bracketed hint
  // because it's the more specific authoritative form.
  let tz = "Z";
  const inlineTz = suffix.match(/^([+-])(\d{2}):?(\d{2})/);
  if (inlineTz) {
    tz = `${inlineTz[1]}${inlineTz[2]}:${inlineTz[3]}`;
  } else if (suffix.startsWith("Z")) {
    tz = "Z";
  } else if (tzFromBracket) {
    // Bracket form: `+10` or `+10:30`
    const m = tzFromBracket.match(/^([+-]?)(\d{1,2})(?::(\d{1,2}))?$/);
    if (m) {
      const sign = m[1] === "-" ? "-" : "+";
      const hh = m[2].padStart(2, "0");
      const mm = (m[3] ?? "00").padStart(2, "0");
      tz = `${sign}${hh}:${mm}`;
    }
  }
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}${msPart}${tz}`;
  if (Number.isNaN(new Date(iso).getTime())) return null;
  return iso;
}

export function parseOFX(content: string): { rows: ImportRow[]; meta: OFXMeta } {
  const institution = extractTag(content, "ORG") ?? extractTag(content, "FI");
  const accountId = extractTag(content, "ACCTID");
  const accountType = extractTag(content, "ACCTTYPE");
  const bankId = extractTag(content, "BANKID");
  const currency = extractTag(content, "CURDEF");
  const dtStartRaw = extractTag(content, "DTSTART");
  const dtEndRaw = extractTag(content, "DTEND");

  function readBalance(tag: string): OFXBalance | undefined {
    const block = extractBlock(content, tag);
    if (!block) return undefined;
    const amt = extractTag(block, "BALAMT");
    if (!amt) return undefined;
    const asOfRaw = extractTag(block, "DTASOF");
    return { amount: amt, asOf: asOfRaw ? parseOFXDate(asOfRaw) : null };
  }

  const meta: OFXMeta = {
    institution,
    accountId,
    accountType,
    bankId,
    currency,
    statementStart: dtStartRaw ? parseOFXDate(dtStartRaw) : undefined,
    statementEnd: dtEndRaw ? parseOFXDate(dtEndRaw) : undefined,
    ledgerBalance: readBalance("LEDGERBAL"),
    availableBalance: readBalance("AVAILBAL"),
  };

  // Extract all STMTTRN blocks
  const txnRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  const rows: ImportRow[] = [];

  function pushFromBlock(block: string) {
    const dateRaw = extractTag(block, "DTPOSTED") ?? extractTag(block, "DTUSER") ?? "";
    const date = parseOFXDate(dateRaw);
    const postedAt = parseOFXTimestamp(dateRaw);
    const amount = formatAmount(parseFloat(extractTag(block, "TRNAMT") ?? "0"));
    const payee = (extractTag(block, "NAME") ?? extractTag(block, "MEMO") ?? "").trim();
    const description = extractTag(block, "MEMO") ?? payee;
    // FITID disambiguates identical-looking txns from the bank's perspective.
    // Fallback (when missing) appends the row's position so within-batch
    // duplicates still get distinct hashes — same date+amount+payee no longer
    // means same hash.
    const rawId =
      extractTag(block, "FITID") ?? `ofx-${rows.length}-${date}-${amount}`;
    const importHash = newImportHash({ date, amount, payee, rawId });
    rows.push({
      date,
      amount,
      payee,
      description,
      rawId,
      importHash,
      postedAt,
      trnType: extractTag(block, "TRNTYPE"),
      checkNum: extractTag(block, "CHECKNUM"),
      refNum: extractTag(block, "REFNUM"),
    });
  }

  let match;
  while ((match = txnRegex.exec(content)) !== null) {
    pushFromBlock(match[1]);
  }

  // Fallback: SGML-style (no closing tags)
  if (!rows.length) {
    const sgmlBlocks = content.split("<STMTTRN>").slice(1);
    for (const block of sgmlBlocks) pushFromBlock(block);
  }

  assignPostedSeq(rows);

  return { rows, meta };
}
