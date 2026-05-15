"use client";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronUp, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Banknote,
  CreditCard,
  FileCheck,
  HandCoins,
  HelpCircle,
  Lock,
  Pause,
  Percent,
  Receipt,
  Repeat,
  Search,
  ShoppingCart,
  StickyNote,
  TrendingUp,
  Unlink,
  Wallet,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { amountClass, cn, formatAUD, formatDate } from "@/lib/utils";
import { colourForFrequency } from "@/lib/schedule-colours";
import { CategoryPicker } from "./category-picker";
import { NotesCell } from "./notes-cell";
import { ScheduleButton } from "./schedule-button";
import { ScheduledMatchPill } from "./scheduled-match-pill";

/** Shape of a row coming out of /api/transactions (the GET handler).
 * The fields cover everything the main list, the day-detail panel,
 * and the row-expansion metadata panel need. */
export interface TransactionRowData {
  id: string;
  date: string;
  amount: string;
  payee: string | null;
  description: string | null;
  notes: string | null;
  accountId: string;
  accountName: string | null;
  accountColor: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transferPairId: string | null;
  pairAccountId: string | null;
  pairAccountName: string | null;
  pairAccountColor: string | null;
  pairAmount: string | null;
  pairDate: string | null;
  pairPayee: string | null;
  balance: string | null;
  bankBalance: string | null;
  isReconciled: boolean;
  type: string | null;
  isTransfer: boolean;
  normalizedPayee: string | null;
  postedAt: string | null;
  postedSeq: number | null;
  createdAt: string;
  updatedAt: string;
  importLogId: string | null;
  importHash: string | null;
  rawFitid: string | null;
  importFormat: string | null;
}

/** Scheduled-match metadata produced by the main list's match-loop —
 * passed in so the row can render the inline pill that links to the
 * originating recurring occurrence. */
export interface RowScheduledMatch {
  id: string;
  frequency: string;
  interval: number;
  occurrenceDate: string;
  payee: string | null;
}

interface CategoryLite {
  id: string;
  name: string;
  parentId: string | null;
}

interface AccountLite {
  id: string;
  name: string;
  color: string;
}

/** Render an `<Icon>`-shaped representation of the bank-supplied
 * transaction type field (OFX TRNTYPE, QIF L, CSV Categories). Pulled
 * out as a top-level helper so it stays tree-shake-friendly. */
export function iconForType(rawType: string | null | undefined): {
  Icon: typeof Receipt;
  label: string;
  tone: string;
} | null {
  if (!rawType) return null;
  const t = rawType.trim().toUpperCase();
  if (!t) return null;
  const incoming = "text-emerald-500/70";
  const outgoing = "text-rose-500/70";
  if (t === "FEE" || t === "SRVCHG" || t === "MISSED PAYMENT FEE") {
    return { Icon: Receipt, label: rawType, tone: "text-red-500/70" };
  }
  if (t === "INT" || t.startsWith("INTEREST")) {
    return { Icon: Percent, label: rawType, tone: "text-blue-500/70" };
  }
  if (t === "DIV" || t.startsWith("DIVIDEND")) {
    return { Icon: TrendingUp, label: rawType, tone: incoming };
  }
  if (t === "POS" || t.startsWith("POINT OF SALE") || t === "EFTPOS") {
    return { Icon: ShoppingCart, label: rawType, tone: "text-violet-500/70" };
  }
  if (t === "ATM") {
    return { Icon: CreditCard, label: rawType, tone: "text-slate-500/70" };
  }
  if (t === "CHECK" || t === "CHEQUE") {
    return { Icon: FileCheck, label: rawType, tone: "text-indigo-500/70" };
  }
  if (t === "CASH" || t === "DEP" || t.startsWith("DEPOSIT")) {
    return { Icon: Banknote, label: rawType, tone: incoming };
  }
  if (t === "DIRECTDEP" || t === "DIRECT DEP") {
    return { Icon: ArrowDownToLine, label: rawType, tone: incoming };
  }
  if (t === "DIRECTDEBIT" || t === "DIRECT DEBIT") {
    return { Icon: ArrowUpFromLine, label: rawType, tone: outgoing };
  }
  if (t === "REPEATPMT" || t.startsWith("REPEAT")) {
    return { Icon: Repeat, label: rawType, tone: "text-cyan-500/70" };
  }
  if (
    t === "XFER" ||
    t === "TRANSFER" ||
    t.startsWith("TFR") ||
    t.startsWith("TRANSFER")
  ) {
    return { Icon: ArrowLeftRight, label: rawType, tone: "text-amber-500/70" };
  }
  if (
    t === "PAYMENT" ||
    t.startsWith("LOAN PAYMENT") ||
    t.startsWith("AUTOMATIC PAYMENT")
  ) {
    return { Icon: HandCoins, label: rawType, tone: outgoing };
  }
  if (t === "CREDIT") {
    return { Icon: ArrowDownToLine, label: rawType, tone: incoming };
  }
  if (t === "DEBIT") {
    return { Icon: ArrowUpFromLine, label: rawType, tone: outgoing };
  }
  if (t === "HOLD") {
    return { Icon: Pause, label: rawType, tone: "text-amber-500/70" };
  }
  if (t === "OTHER") {
    return { Icon: HelpCircle, label: rawType, tone: "text-slate-500/70" };
  }
  return { Icon: Wallet, label: rawType, tone: "text-slate-500/70" };
}

function ExpandedField({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-3" : ""}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </p>
      <div className="text-foreground/90">{children}</div>
    </div>
  );
}

/** Inline reconcile toggle. Sits inside the expanded row panel so the
 * operator can flip a txn's reconciled flag without leaving the
 * transactions list. PATCHes `/api/transactions/{id}` directly so
 * SWR caches stay coherent via the parent's onChange callback. */
/** The row's click-to-expand metadata panel. Opens in read mode;
 * the pencil icon at the top-right switches to edit mode where the
 * user-controllable text fields (payee, description, amount, date,
 * bank type, bank balance, FITID) become inputs. Save batches the
 * changed fields into a single PATCH; Cancel discards. Read-only
 * system fields (timestamps, hashes, normalised payee, transaction
 * ID) stay as `<code>` blocks throughout. */
function ExpandedPanel({
  t,
  refresh,
}: {
  t: TransactionRowData;
  refresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Only the user-controllable fields the PATCH endpoint accepts.
  // Bank-derived metadata (type, balance, FITID) stays read-only —
  // editing those is an edge case and would need a schema widening
  // we don't have a reason for yet.
  const [draft, setDraft] = useState({
    date: t.date,
    payee: t.payee ?? "",
    amount: t.amount,
    description: t.description ?? "",
  });
  function enterEdit() {
    setDraft({
      date: t.date,
      payee: t.payee ?? "",
      amount: t.amount,
      description: t.description ?? "",
    });
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
  }

  async function save() {
    // Minimal patch — only changed fields get sent so an
    // Edit-then-Save-without-edits is a no-op.
    const patch: Record<string, unknown> = {};
    if (draft.date !== t.date) patch.date = draft.date;
    if (draft.payee !== (t.payee ?? "")) patch.payee = draft.payee || "";
    if (draft.amount !== t.amount) patch.amount = draft.amount;
    if (draft.description !== (t.description ?? ""))
      patch.description = draft.description || "";
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/transactions/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `PATCH ${res.status}`);
      }
      toast.success("Transaction updated");
      setEditing(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="bg-muted/40">
      <td
        colSpan={100}
        className="px-6 py-3 border-b"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end mb-2 gap-1.5">
          {editing ? (
            <>
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-background transition-colors disabled:opacity-60"
              >
                <X className="h-3 w-3" /> Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-60"
              >
                <Save className="h-3 w-3" /> {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={enterEdit}
              title="Edit this transaction"
              aria-label="Edit transaction"
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-xs">
          {editing && (
            <>
              <ExpandedField label="Date">
                <EditInput
                  type="date"
                  value={draft.date}
                  onChange={(v) => setDraft((d) => ({ ...d, date: v }))}
                />
              </ExpandedField>
              <ExpandedField label="Payee">
                <EditInput
                  value={draft.payee}
                  onChange={(v) => setDraft((d) => ({ ...d, payee: v }))}
                />
              </ExpandedField>
              <ExpandedField label="Amount">
                <EditInput
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={draft.amount}
                  onChange={(v) => setDraft((d) => ({ ...d, amount: v }))}
                />
              </ExpandedField>
            </>
          )}
          <ExpandedField label="Notes" wide>
            <NotesCell
              transactionId={t.id}
              notes={t.notes}
              onSaved={refresh}
            />
          </ExpandedField>
          <ExpandedField label="Description" wide>
            {editing ? (
              <EditInput
                value={draft.description}
                onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
              />
            ) : (
              <span>{t.description || "—"}</span>
            )}
          </ExpandedField>
          <ExpandedField label="Reconciled">
            <ReconcileToggle
              transactionId={t.id}
              isReconciled={t.isReconciled}
              onChange={refresh}
            />
          </ExpandedField>
          <ExpandedField label="Bank type">{t.type ?? "—"}</ExpandedField>
          <ExpandedField label="Bank balance">
            {t.bankBalance != null ? formatAUD(t.bankBalance) : "—"}
          </ExpandedField>
          <ExpandedField label="Bank ID (FITID)">
            <code className="text-[11px] break-all">{t.rawFitid ?? "—"}</code>
          </ExpandedField>
          {/* Read-only system fields — stay rendered in both modes
              so the operator can refer to them while editing the
              user-controllable values above. */}
          <ExpandedField label="Posted">
            {t.postedAt ? new Date(t.postedAt).toLocaleString() : "—"}
          </ExpandedField>
          <ExpandedField label="Posted seq">{t.postedSeq ?? "—"}</ExpandedField>
          <ExpandedField label="Imported">
            {new Date(t.createdAt).toLocaleString()}
          </ExpandedField>
          <ExpandedField label="Import format">
            {t.importFormat ? t.importFormat.toUpperCase() : "Manual"}
          </ExpandedField>
          <ExpandedField label="Updated">
            {new Date(t.updatedAt).toLocaleString()}
          </ExpandedField>
          <ExpandedField label="Import hash">
            <code className="text-[11px] break-all">{t.importHash ?? "—"}</code>
          </ExpandedField>
          <ExpandedField label="Normalised payee">
            <code className="text-[11px] break-all">
              {t.normalizedPayee ?? "—"}
            </code>
          </ExpandedField>
          <ExpandedField label="Transaction ID">
            <code className="text-[11px] break-all">{t.id}</code>
          </ExpandedField>
        </div>
      </td>
    </tr>
  );
}

/** Inline text input styled to match the read-mode field height so
 * Edit mode doesn't reflow the grid. Used inside ExpandedField. */
function EditInput({
  value,
  onChange,
  type = "text",
  inputMode,
  step,
}: {
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date" | "number";
  inputMode?: "decimal";
  step?: string;
}) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-6 w-full text-xs px-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-indigo-500"
    />
  );
}

function ReconcileToggle({
  transactionId,
  isReconciled,
  onChange,
}: {
  transactionId: string;
  isReconciled: boolean;
  onChange: () => void;
}) {
  return (
    <Switch
      checked={isReconciled}
      onCheckedChange={async (next) => {
        const res = await fetch(`/api/transactions/${transactionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isReconciled: next }),
        });
        if (res.ok) onChange();
      }}
      aria-label="Toggle reconciled flag"
      className="h-4"
    />
  );
}

export interface TransactionRowProps {
  t: TransactionRowData;
  accounts: AccountLite[];
  categories: CategoryLite[];

  /** Show notes inline as a second line under the payee (otherwise
   * notes render as a hover icon next to the payee). */
  showNotes?: boolean;
  /** Show the linked-counterpart cells (direction gutter, pair
   * account, optionally pair payee / pair amount). Only the main
   * transactions list passes true — panel-style consumers leave it
   * off. */
  showLinkedPanel?: boolean;
  /** When the linked panel is shown, also include the pair payee and
   * pair amount cells. */
  showLinkedDetails?: boolean;
  /** Render the running-balance column. */
  showBalance?: boolean;
  /** Render the date column. Off in single-day contexts where every
   * row shares the same date. */
  showDate?: boolean;
  /** Render the leading checkbox column. Off in panel contexts where
   * bulk operations aren't offered. */
  showCheckbox?: boolean;

  /** Row-level state (parents own the source of truth). */
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;

  /** Scheduled-match metadata, when this transaction is the realised
   * counterpart of a recurring occurrence. */
  match?: RowScheduledMatch | null;

  /** Unlink callback — invoked from the linked-details cell. */
  onUnpair?: (txnId: string) => void;

  /** Refresh callback fired after inline edits (CategoryPicker,
   * NotesCell). */
  onChange?: () => void;
}

export function TransactionRow({
  t,
  accounts,
  categories,
  showNotes = false,
  showLinkedPanel = false,
  showLinkedDetails = false,
  showBalance = false,
  showDate = true,
  showCheckbox = false,
  isSelected = false,
  onToggleSelect,
  isExpanded = false,
  onToggleExpand,
  match = null,
  onUnpair,
  onChange,
}: TransactionRowProps) {
  const linked = !!t.transferPairId;
  const isOutgoing = parseFloat(t.amount) < 0;
  const isScheduledMatch = !!match;
  const stripeColour = isScheduledMatch
    ? colourForFrequency(match.frequency)
    : undefined;
  const refresh = onChange ?? (() => {});
  return (
    <Fragment>
      <tr
        onClick={(e) => {
          // Only treat clicks on inert cells as the expand trigger —
          // anything inside an actual control (input, button, link,
          // ARIA widget) keeps its own behaviour.
          const el = e.target as HTMLElement;
          if (
            el.closest(
              'a, button, input, label, select, textarea, ' +
                '[role="button"], [role="combobox"], ' +
                '[role="option"], [role="textbox"], ' +
                '[data-no-expand]',
            )
          ) {
            return;
          }
          onToggleExpand?.();
        }}
        className={cn(
          "group cursor-pointer hover:bg-muted",
          isSelected && "bg-indigo-500/30 dark:bg-indigo-500/40",
        )}
      >
        {showCheckbox && (
          <td
            className="px-2 py-2 text-center"
            style={
              stripeColour
                ? { boxShadow: `inset 3px 0 0 ${stripeColour}` }
                : undefined
            }
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              aria-label={`Select transaction ${t.payee || t.date}`}
              checked={isSelected}
              onChange={() => onToggleSelect?.()}
              className="cursor-pointer accent-indigo-600"
            />
          </td>
        )}
        {showDate && (
          <td
            className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap"
            style={
              !showCheckbox && stripeColour
                ? { boxShadow: `inset 3px 0 0 ${stripeColour}` }
                : undefined
            }
            title={format(parseISO(t.date), "EEEE, d MMMM yyyy")}
          >
            <span className="inline-flex items-center gap-1.5">
              {t.isReconciled && (
                <Lock
                  className="h-3 w-3 text-emerald-600 shrink-0"
                  aria-label="Reconciled"
                />
              )}
              {formatDate(t.date)}
            </span>
          </td>
        )}
        <td
          className="px-2 py-1.5"
          style={
            !showCheckbox && !showDate && stripeColour
              ? { boxShadow: `inset 3px 0 0 ${stripeColour}` }
              : undefined
          }
        >
          {t.accountName && (
            <span
              className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
              style={{ backgroundColor: t.accountColor ?? "#94a3b8" }}
            >
              {t.accountName}
            </span>
          )}
        </td>
        <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
          <CategoryPicker
            transactionId={t.id}
            categoryId={t.categoryId ?? null}
            categoryName={t.categoryName ?? null}
            categories={categories}
          />
        </td>
        <td className="px-2 py-2 align-middle">
          {(() => {
            // Linked-transfer rows always show the transfer arrow in
            // this column regardless of the bank's TRNTYPE — the link
            // relationship is more relevant info than DEBIT/CREDIT.
            if (linked) {
              return (
                <span
                  className="inline-flex items-center justify-center text-amber-500/70"
                  title="Linked transfer"
                  aria-label="Linked transfer"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                </span>
              );
            }
            const meta = iconForType(t.type);
            if (!meta) return null;
            const { Icon, label, tone } = meta;
            return (
              <span
                className={cn(
                  "inline-flex items-center justify-center",
                  tone,
                )}
                title={label}
                aria-label={`Type: ${label}`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
            );
          })()}
        </td>
        <td className="px-2 py-1.5 w-full max-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="font-medium flex items-center gap-1.5 min-w-0">
              {/* Desktop only — on mobile the full payee is rendered
                  on its own full-width row below (via the
                  lg:hidden <tr> after this one). Truncating in-cell
                  on mobile leaves the payee unreadable in a narrow
                  column. */}
              <span className="hidden lg:inline truncate min-w-0">
                {t.payee || t.description || "—"}
              </span>
              {!showNotes && t.notes?.trim() && (
                <span
                  className="inline-flex shrink-0 cursor-help"
                  title={t.notes}
                  aria-label={`Note: ${t.notes}`}
                >
                  <StickyNote className="h-3 w-3 text-amber-500" />
                </span>
              )}
              {isScheduledMatch ? (
                <ScheduledMatchPill
                  scheduledId={match.id}
                  frequency={match.frequency}
                  interval={match.interval}
                  realDate={t.date}
                  scheduledDate={match.occurrenceDate}
                  schedulePayee={match.payee}
                />
              ) : (
                <ScheduleButton
                  transaction={{
                    payee: t.payee,
                    amount: t.amount,
                    categoryId: t.categoryId ?? null,
                    accountId: t.accountId,
                    date: t.date,
                    transferPairId: t.transferPairId,
                    pairAccountId: t.pairAccountId,
                  }}
                  accounts={accounts}
                  categoriesProp={
                    categories as unknown as Parameters<
                      typeof ScheduleButton
                    >[0]["categoriesProp"]
                  }
                />
              )}
            </span>
            {t.payee?.trim() && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const url = `https://www.google.com/search?q=${encodeURIComponent(t.payee!)}`;
                  const w = Math.min(900, window.screen.availWidth - 100);
                  const h = Math.min(720, window.screen.availHeight - 80);
                  const left = Math.max(
                    0,
                    (window.screen.availWidth - w) / 2,
                  );
                  const top = Math.max(
                    0,
                    (window.screen.availHeight - h) / 2,
                  );
                  window.open(
                    url,
                    "payee-search",
                    `popup=yes,width=${w},height=${h},left=${left},top=${top}`,
                  );
                }}
                className="shrink-0 p-1 -my-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title={`Search Google for "${t.payee}"`}
                aria-label="Search Google for this payee"
              >
                <Search className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {showNotes && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              <NotesCell
                transactionId={t.id}
                notes={t.notes}
                onSaved={refresh}
              />
            </div>
          )}
          {linked && (
            <span className="block lg:hidden text-[10px] text-muted-foreground mt-0.5 truncate">
              ↔ {t.pairAccountName} ·{" "}
              <span className={amountClass(t.pairAmount ?? "0")}>
                {formatAUD(t.pairAmount ?? "0")}
              </span>
            </span>
          )}
        </td>
        <td className="px-2 py-1.5 text-right whitespace-nowrap">
          <span className={cn("font-semibold", amountClass(t.amount))}>
            {formatAUD(t.amount)}
          </span>
        </td>
        {showBalance && (
          <td
            className={cn(
              "px-2 py-1.5 text-right whitespace-nowrap tabular-nums",
              t.balance != null
                ? amountClass(t.balance)
                : "text-muted-foreground",
            )}
          >
            {t.balance != null ? formatAUD(t.balance) : "—"}
            {(() => {
              if (t.bankBalance == null || t.balance == null) return null;
              const bank = parseFloat(t.bankBalance);
              const computed = parseFloat(t.balance);
              if (!Number.isFinite(bank) || !Number.isFinite(computed)) {
                return null;
              }
              const delta = +(bank - computed).toFixed(2);
              if (Math.abs(delta) < 0.01) return null;
              return (
                <span
                  className="ml-1.5 text-red-600 font-semibold"
                  title={`Bank says ${formatAUD(bank)} (Δ ${formatAUD(delta)})`}
                  aria-label={`Bank balance mismatch — bank says ${formatAUD(bank)}`}
                >
                  ✗
                </span>
              );
            })()}
          </td>
        )}
        {showLinkedPanel && (
          <>
            <td className="hidden lg:table-cell border-l-2 border-border bg-muted/30 p-0 align-middle text-center">
              {linked && (
                <span
                  className={cn(
                    "inline-block text-xl leading-none font-bold",
                    isOutgoing ? "text-red-500" : "text-emerald-600",
                  )}
                  title={isOutgoing ? "Outgoing" : "Incoming"}
                  aria-label={isOutgoing ? "Outgoing" : "Incoming"}
                >
                  {isOutgoing ? "→" : "←"}
                </span>
              )}
            </td>
            <td className="hidden lg:table-cell px-2 py-1.5 whitespace-nowrap">
              {linked && t.pairAccountName ? (
                <Link
                  href={`/transactions?accountId=${t.pairAccountId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] hover:opacity-80 transition-opacity"
                  style={{
                    backgroundColor: t.pairAccountColor ?? "#94a3b8",
                  }}
                >
                  {t.pairAccountName}
                </Link>
              ) : (
                <span className="text-muted-foreground/40 text-xs">—</span>
              )}
            </td>
            {showLinkedDetails && (
              <>
                <td className="hidden lg:table-cell px-2 py-1.5 max-w-[220px]">
                  {linked ? (
                    <div className="flex items-center gap-1">
                      <span className="truncate text-xs text-muted-foreground">
                        {t.pairPayee || "—"}
                      </span>
                      {onUnpair && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUnpair(t.id);
                          }}
                          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Unlink transfer"
                        >
                          <Unlink className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ) : null}
                </td>
                <td className="hidden lg:table-cell px-2 py-1.5 text-right whitespace-nowrap">
                  {linked && t.pairAmount ? (
                    <span
                      className={cn(
                        "font-semibold",
                        amountClass(t.pairAmount),
                      )}
                    >
                      {formatAUD(t.pairAmount)}
                    </span>
                  ) : null}
                </td>
              </>
            )}
          </>
        )}
      </tr>
      {/* Mobile-only second row: the payee in full, spanning every
          column. The tbody's `divide-y` would normally add a top
          border between this and the main row; `!border-t-0`
          overrides that so the payee reads as part of the main row
          visually. */}
      <tr
        className="lg:hidden !border-t-0 group cursor-pointer hover:bg-muted"
        onClick={() => onToggleExpand?.()}
      >
        <td
          colSpan={100}
          className="px-3 pb-2 pt-0 text-sm font-medium break-words"
        >
          {t.payee || t.description || "—"}
        </td>
      </tr>
      {isExpanded && <ExpandedPanel t={t} refresh={refresh} />}
    </Fragment>
  );
}

// ─── Sortable table header ────────────────────────────────────────────────────
// Used by both the main /transactions list and the calendar's day-detail
// panel. Same column layout as <TransactionRow>; the prop flags below
// drive which headers actually render so the two views stay coordinated
// without duplicating the cells.

export type TransactionSortCol =
  | "date"
  | "account"
  | "category"
  | "payee"
  | "value";

export interface TransactionSortState {
  by: TransactionSortCol;
  order: "asc" | "desc";
}

export interface TransactionsTableHeaderProps {
  showCheckbox?: boolean;
  showDate?: boolean;
  showBalance?: boolean;
  showLinkedPanel?: boolean;
  showLinkedDetails?: boolean;

  /** Current sort state. When omitted, headers render as plain labels
   * (no click handlers, no chevron). */
  sort?: TransactionSortState | null;
  onSort?: (col: TransactionSortCol) => void;

  /** Select-all checkbox state, only used when showCheckbox=true. */
  allSelected?: boolean;
  someSelected?: boolean;
  onToggleAll?: () => void;

  /** Optional direction filter that sits inside the linked-panel header
   * column on the main list. The day-detail panel never enables the
   * linked panel and so doesn't pass this. */
  directionFilter?: ReactNode;
}

export function TransactionsTableHeader({
  showCheckbox = false,
  showDate = true,
  showBalance = false,
  showLinkedPanel = false,
  showLinkedDetails = false,
  sort = null,
  onSort,
  allSelected = false,
  someSelected = false,
  onToggleAll,
  directionFilter,
}: TransactionsTableHeaderProps) {
  function ariaSort(col: TransactionSortCol): "ascending" | "descending" | "none" {
    if (!sort || sort.by !== col) return "none";
    return sort.order === "asc" ? "ascending" : "descending";
  }
  function indicator(col: TransactionSortCol) {
    if (!sort || sort.by !== col) return null;
    return sort.order === "asc" ? (
      <ChevronUp className="h-3 w-3 ml-0.5" aria-hidden />
    ) : (
      <ChevronDown className="h-3 w-3 ml-0.5" aria-hidden />
    );
  }
  function sortable(label: string, col: TransactionSortCol) {
    if (!onSort) return <span className="flex items-center">{label}</span>;
    return (
      <button
        type="button"
        onClick={() => onSort(col)}
        className="hover:text-foreground transition-colors flex items-center"
      >
        {label}
        {indicator(col)}
      </button>
    );
  }
  return (
    <thead>
      <tr className="border-b bg-muted/50 text-xs text-muted-foreground font-medium">
        {showCheckbox && (
          <th className="px-2 py-2 w-[32px]">
            <input
              type="checkbox"
              aria-label="Select all visible transactions"
              checked={allSelected}
              ref={(el) => {
                // Indeterminate state can only be set via the DOM, not
                // a React prop. When some-but-not-all visible rows are
                // selected, surface the partial state on the box.
                if (el) el.indeterminate = !allSelected && someSelected;
              }}
              onChange={() => onToggleAll?.()}
              className="cursor-pointer accent-indigo-600"
            />
          </th>
        )}
        {showDate && (
          <th
            aria-sort={ariaSort("date")}
            className="text-left px-2 py-1.5 whitespace-nowrap"
          >
            {sortable("Date", "date")}
          </th>
        )}
        <th
          aria-sort={ariaSort("account")}
          className="text-left px-2 py-1.5 whitespace-nowrap"
        >
          {sortable("Account", "account")}
        </th>
        <th
          aria-sort={ariaSort("category")}
          className="text-left px-2 py-1.5"
        >
          {sortable("Category", "category")}
        </th>
        <th
          className="px-2 py-2 w-[28px]"
          title="Bank-supplied transaction type (OFX TRNTYPE / QIF L / CSV Categories)"
        >
          <span className="sr-only">Type</span>
        </th>
        <th
          aria-sort={ariaSort("payee")}
          className="text-left px-2 py-1.5 w-full max-w-0"
        >
          {sortable("Payee", "payee")}
        </th>
        <th
          aria-sort={ariaSort("value")}
          className="text-right px-2 py-1.5 whitespace-nowrap"
        >
          {onSort ? (
            <button
              type="button"
              onClick={() => onSort("value")}
              className="hover:text-foreground transition-colors flex items-center ml-auto"
            >
              Value{indicator("value")}
            </button>
          ) : (
            <span>Value</span>
          )}
        </th>
        {showBalance && (
          <th className="text-right px-2 py-1.5 whitespace-nowrap">Balance</th>
        )}
        {showLinkedPanel && (
          <>
            <th className="hidden lg:table-cell border-l-2 border-border bg-muted/30 p-1 align-middle">
              {directionFilter}
            </th>
            <th className="hidden lg:table-cell text-left px-2 py-1.5 whitespace-nowrap">
              Linked account
            </th>
            {showLinkedDetails && (
              <>
                <th className="hidden lg:table-cell text-left px-2 py-1.5 max-w-[220px]">
                  Linked payee
                </th>
                <th className="hidden lg:table-cell text-right px-2 py-1.5 whitespace-nowrap">
                  Linked value
                </th>
              </>
            )}
          </>
        )}
      </tr>
    </thead>
  );
}

/** Client-side comparator for TransactionRowData against a sort
 * state. Mirrors the server-side sort in /api/transactions so the
 * day-detail panel's local sort reads the same way as the main list's
 * server-paginated sort. */
export function compareTransactions(
  a: TransactionRowData,
  b: TransactionRowData,
  sort: TransactionSortState,
): number {
  let cmp = 0;
  switch (sort.by) {
    case "date":
      cmp = a.date.localeCompare(b.date);
      break;
    case "account":
      cmp = (a.accountName ?? "").localeCompare(b.accountName ?? "");
      break;
    case "category":
      cmp = (a.categoryName ?? "").localeCompare(b.categoryName ?? "");
      break;
    case "payee":
      cmp = (a.payee ?? a.description ?? "").localeCompare(
        b.payee ?? b.description ?? "",
      );
      break;
    case "value":
      cmp = parseFloat(a.amount) - parseFloat(b.amount);
      break;
  }
  return sort.order === "asc" ? cmp : -cmp;
}

// ─── Scheduled-event row ──────────────────────────────────────────────────────
// Forecast occurrences from /api/cashflow are projection-shaped (no
// notes, no real categoryId, no transferPair); rendering them through
// the full <TransactionRow> would either light up inert inline-edit
// affordances or need a `readOnly` mode that complicates every cell.
// Instead this thin sibling emits a `<tr>` with the same column
// structure as TransactionRow so both row types share the
// TransactionsTableHeader and live in one table — visually distinct
// via a soft indigo tint so the operator can tell forecast rows from
// realised ones at a glance.

export interface ScheduledRowEvent {
  /** Stable key for React's `key` prop. */
  id: string;
  /** Optional bound account; rendered as the same chip the real rows
   * use. */
  accountId?: string;
  payee: string;
  description: string;
  amount: number;
}

export function ScheduledTransactionRow({
  event,
  accounts,
  showDate = false,
  date,
  showCheckbox = false,
  showBalance = false,
  showLinkedPanel = false,
  showLinkedDetails = false,
}: {
  event: ScheduledRowEvent;
  accounts: AccountLite[];
  showDate?: boolean;
  /** When showDate is on, the date string to render (forecast date). */
  date?: string;
  showCheckbox?: boolean;
  showBalance?: boolean;
  showLinkedPanel?: boolean;
  showLinkedDetails?: boolean;
}) {
  const acct = event.accountId
    ? accounts.find((a) => a.id === event.accountId)
    : undefined;
  return (
    <tr className="bg-indigo-500/[0.06] hover:bg-indigo-500/10">
      {showCheckbox && <td className="px-2 py-2 w-[32px]" />}
      {showDate && (
        <td
          className="px-2 py-1.5 text-xs text-muted-foreground whitespace-nowrap"
          title={
            date
              ? format(parseISO(date), "EEEE, d MMMM yyyy")
              : undefined
          }
        >
          {date ? formatDate(date) : "—"}
        </td>
      )}
      <td className="px-2 py-1.5">
        {acct && (
          <span
            className="inline-block px-1.5 py-0.5 rounded text-white text-[10px] whitespace-nowrap"
            style={{ backgroundColor: acct.color }}
          >
            {acct.name}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5 text-xs text-indigo-500 italic whitespace-nowrap">
        Scheduled
      </td>
      <td
        className="px-2 py-2 align-middle text-amber-500/70"
        title="Scheduled occurrence"
      >
        <Repeat className="h-3.5 w-3.5" aria-label="Scheduled" />
      </td>
      <td className="px-2 py-1.5 w-full max-w-0">
        <span className="text-muted-foreground truncate inline-block max-w-full">
          {event.payee || event.description || "—"}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <span className={cn("font-semibold", amountClass(event.amount))}>
          {formatAUD(event.amount)}
        </span>
      </td>
      {showBalance && <td className="px-2 py-1.5 text-right" />}
      {showLinkedPanel && (
        <>
          <td className="hidden lg:table-cell" />
          <td className="hidden lg:table-cell" />
          {showLinkedDetails && (
            <>
              <td className="hidden lg:table-cell" />
              <td className="hidden lg:table-cell" />
            </>
          )}
        </>
      )}
    </tr>
  );
}

/** Comparator for ScheduledRowEvent against the same sort state the
 * real rows use. Missing fields (no date, no category) fall back to
 * payee/amount so the sort still produces a stable ordering. */
export function compareScheduled(
  a: ScheduledRowEvent,
  b: ScheduledRowEvent,
  sort: TransactionSortState,
): number {
  let cmp = 0;
  switch (sort.by) {
    case "date":
      // Scheduled events all share the day's date in the panel
      // context, so the sub-order falls through to payee.
      cmp = (a.payee ?? "").localeCompare(b.payee ?? "");
      break;
    case "account":
      // No accountName lookup here — caller can pre-sort if it
      // needs the chip's name. Fallback to accountId.
      cmp = (a.accountId ?? "").localeCompare(b.accountId ?? "");
      break;
    case "category":
      // No real category on a forecast; keep stable via payee.
      cmp = (a.payee ?? "").localeCompare(b.payee ?? "");
      break;
    case "payee":
      cmp = (a.payee ?? a.description ?? "").localeCompare(
        b.payee ?? b.description ?? "",
      );
      break;
    case "value":
      cmp = a.amount - b.amount;
      break;
  }
  return sort.order === "asc" ? cmp : -cmp;
}
