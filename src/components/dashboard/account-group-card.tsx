"use client";

import { useState } from "react";
import Link from "next/link";
import { Layers, Minus, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSwrJson } from "@/hooks/use-swr-json";
import { GROUPS } from "@/components/accounts/group-accounts";
import {
  computeAccountGroup,
  flipSign,
  parseAccountGroupConfig,
  toggleMember,
  type AccountGroupMember,
} from "@/lib/dashboard/account-group";
import { HIT_AREA } from "@/lib/ui/hit-area";
import { amountClass, cn, formatAUD } from "@/lib/utils";
import type { Account } from "@/db/schema";

/** Dashboard widget combining several user-picked accounts into one balance
 *  — e.g. savings minus credit cards and loans. Selection lives in the layout
 *  entry's `config` (`{ title, members: [{ id, sign }] }`), so each placed
 *  instance can track a different group. Debts are stored as negative
 *  balances, so "savings − liabilities" is a plain sum; the per-account
 *  subtract toggle covers anything recorded the other way round. */
export function AccountGroupCard({
  config,
  editMode,
  onConfigChange,
}: {
  config?: Record<string, unknown>;
  editMode: boolean;
  onConfigChange?: (next: Record<string, unknown>) => void;
}) {
  const { title, members } = parseAccountGroupConfig(config);
  // Hidden (archived) accounts can be picked too, same as the single-account
  // widget: a closed card or a parked savings goal is often the point.
  const { data } = useSwrJson<Account[]>("/api/accounts?includeArchived=true", {
    revalidateOnFocus: false,
  });
  const accounts: Account[] = Array.isArray(data) ? data : [];
  const result = computeAccountGroup(accounts, members);
  const heading = title || "Account group";

  const save = (next: { title?: string; members?: AccountGroupMember[] }) =>
    onConfigChange?.({ title: next.title ?? title, members: next.members ?? members });

  return (
    <Card data-size="sm" className="h-full flex flex-col">
      <CardHeader className="pb-1 shrink-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5 min-w-0">
          <Layers className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{heading}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 flex flex-col">
        {editMode ? (
          <GroupEditor
            accounts={accounts}
            title={title}
            members={members}
            onTitle={(t) => save({ title: t })}
            onMembers={(m) => save({ members: m })}
          />
        ) : members.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No accounts selected. Enter edit mode to pick the accounts to combine.
          </p>
        ) : (
          <>
            <p className={cn("text-xl font-bold leading-tight shrink-0", amountClass(result.total))}>
              {formatAUD(result.total)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 shrink-0">
              {result.rows.length} account{result.rows.length === 1 ? "" : "s"}
              {result.missing > 0 &&
                ` · ${result.missing} no longer exist${result.missing === 1 ? "s" : ""}`}
            </p>
            <ul className="mt-2 flex-1 min-h-0 overflow-y-auto space-y-0.5 text-xs">
              {result.rows.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between gap-2">
                  <Link
                    href={`/transactions?accountIds=${r.id}`}
                    className="truncate text-muted-foreground hover:text-foreground"
                  >
                    {r.sign === -1 && <span aria-label="subtracted">− </span>}
                    {r.name}
                    {r.isArchived && <span className="text-muted-foreground/60"> (hidden)</span>}
                  </Link>
                  <span className={cn("shrink-0 tabular-nums", amountClass(r.contribution))}>
                    {formatAUD(r.contribution)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GroupEditor({
  accounts,
  title,
  members,
  onTitle,
  onMembers,
}: {
  accounts: Account[];
  title: string;
  members: AccountGroupMember[];
  onTitle: (t: string) => void;
  onMembers: (m: AccountGroupMember[]) => void;
}) {
  // Title is saved on blur/Enter so typing doesn't write the layout per key.
  const [draft, setDraft] = useState(title);
  const [prevTitle, setPrevTitle] = useState(title);
  if (title !== prevTitle) {
    setPrevTitle(title);
    setDraft(title);
  }
  const commitTitle = () => {
    const t = draft.trim();
    if (t !== title) onTitle(t);
  };

  const signOf = new Map(members.map((m) => [m.id, m.sign]));
  const active = accounts.filter((a) => !a.isArchived);
  const claimed = new Set<string>();
  const sections = GROUPS.map((g) => {
    const rows = active.filter((a) => g.types.includes(a.type));
    rows.forEach((a) => claimed.add(a.id));
    return { label: g.label, rows };
  });
  sections.push({ label: "Other", rows: active.filter((a) => !claimed.has(a.id)) });
  sections.push({ label: "Hidden", rows: accounts.filter((a) => a.isArchived) });

  return (
    // widget-cancel-drag: keep react-grid-layout from treating clicks and
    // scrolling in the editor as the start of a widget drag.
    <div className="widget-cancel-drag flex flex-col flex-1 min-h-0 gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitTitle}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        maxLength={60}
        placeholder="Title, e.g. Savings minus debts"
        aria-label="Widget title"
        className="shrink-0 rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
      <p className="shrink-0 text-[10px] leading-snug text-muted-foreground">
        Credit cards and loans already count as negative, so selecting them subtracts what
        you owe. Use − only for an account recorded the other way round.
      </p>
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {accounts.length === 0 && <p className="text-xs text-muted-foreground">No accounts yet.</p>}
        {sections
          .filter((s) => s.rows.length > 0)
          .map((s) => (
            <fieldset key={s.label} className="mb-2">
              <legend className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">
                {s.label}
              </legend>
              {s.rows.map((a) => {
                const sign = signOf.get(a.id);
                const checked = sign !== undefined;
                return (
                  <div key={a.id} className="flex items-center gap-2 py-0.5 text-xs">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onMembers(toggleMember(members, a.id))}
                        className="accent-indigo-600"
                      />
                      <span className="truncate">{a.name}</span>
                      <span className={cn("ml-auto shrink-0 tabular-nums", amountClass(a.currentBalance))}>
                        {formatAUD(a.currentBalance)}
                      </span>
                    </label>
                    <button
                      type="button"
                      disabled={!checked}
                      onClick={() => onMembers(flipSign(members, a.id))}
                      aria-label={
                        sign === -1 ? `Add ${a.name} instead of subtracting` : `Subtract ${a.name}`
                      }
                      aria-pressed={sign === -1}
                      className={cn(
                        HIT_AREA,
                        "shrink-0 rounded border p-0.5 disabled:invisible",
                        sign === -1
                          ? "border-rose-400 text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {sign === -1 ? <Minus className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                    </button>
                  </div>
                );
              })}
            </fieldset>
          ))}
      </div>
    </div>
  );
}
