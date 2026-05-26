"use client";

import { useEffect, useState } from "react";
import { mutate } from "swr";
import { useSwrJson } from "@/hooks/use-swr-json";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Pencil, Check, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/hooks/use-confirm-dialog";
import { formatAUD, amountClass } from "@/lib/utils";
import { formatFy } from "@/lib/tax/fy";
import { SuperHistoryChart } from "./super-history-chart";


interface Snapshot {
  id: string;
  fyEndYear: number;
  balance: string;
  contributions: string;
  /** Free-form person key — see `src/lib/super-people.ts`. Used to
   *  be constrained to "self" | "partner"; loosened in 0.127 so any
   *  number of people can coexist. */
  person: string;
  fundName: string | null;
  notes: string | null;
}

interface YearGroup {
  fyEndYear: number;
  /** snapshots that fall in this FY, keyed by fund_name (null → ""). */
  byFund: Map<string, Snapshot>;
  total: number;
  totalIncrease: number | null;
  totalGainPct: number | null;
}

const num = (s: string | null | undefined): number => (s == null ? 0 : parseFloat(s));
const fundKey = (s: Snapshot): string => s.fundName ?? "";

function groupByYear(snapshots: Snapshot[]): YearGroup[] {
  const byYear = new Map<number, Snapshot[]>();
  for (const s of snapshots) {
    const arr = byYear.get(s.fyEndYear) ?? [];
    arr.push(s);
    byYear.set(s.fyEndYear, arr);
  }
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => a - b);
  const out: YearGroup[] = [];
  let prevTotal: number | null = null;
  for (const year of sortedYears) {
    const rows = byYear.get(year) ?? [];
    const byFund = new Map<string, Snapshot>();
    for (const r of rows) byFund.set(fundKey(r), r);
    const total = rows.reduce((s, r) => s + num(r.balance), 0);
    const totalIncrease = prevTotal != null ? total - prevTotal : null;
    const totalGainPct =
      prevTotal != null && prevTotal > 0 ? (total - prevTotal) / prevTotal : null;
    out.push({ fyEndYear: year, byFund, total, totalIncrease, totalGainPct });
    prevTotal = total;
  }
  return out;
}

function formatPct(p: number | null): string {
  if (p == null) return "—";
  return `${(p * 100).toFixed(2)}%`;
}

const formatFY = formatFy;

export function SuperView({
  person,
  label,
  onDelete,
}: {
  person: string;
  label: string;
  /** Optional — when supplied, the heading shows a small trash
   *  icon that calls back with the person key. The host page
   *  decides whether deletion is allowed (e.g. block deleting the
   *  last person so the page is never empty). */
  onDelete?: (key: string) => void;
}) {
  const swrKey = `/api/super?person=${encodeURIComponent(person)}`;
  const { data: snapshots = [], isLoading } = useSwrJson<Snapshot[]>(swrKey);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const years = groupByYear(snapshots);
  const latest = years.at(-1);

  // Stable column order for fund balances. Prefer the most recent year's
  // ordering so columns stay aligned year-over-year as funds come and go.
  const fundColumns = (() => {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (let i = years.length - 1; i >= 0; i--) {
      for (const key of years[i].byFund.keys()) {
        if (!seen.has(key)) {
          seen.add(key);
          ordered.push(key);
        }
      }
    }
    return ordered;
  })();

  return (
    <div className="space-y-4">
      <EditableHeading person={person} heading={label} onDelete={onDelete} />
      {latest && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Latest balance
              </p>
              <p className="text-2xl font-bold">{formatAUD(latest.total)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                as of {formatFY(latest.fyEndYear)}
                {latest.byFund.size > 1 && ` · ${latest.byFund.size} funds`}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Last YoY change
              </p>
              <p
                className={`text-2xl font-bold ${
                  latest.totalGainPct == null
                    ? ""
                    : amountClass(latest.totalGainPct)
                }`}
              >
                {formatPct(latest.totalGainPct)}
              </p>
              <p
                className={`text-xs mt-1 ${
                  latest.totalIncrease != null
                    ? amountClass(latest.totalIncrease)
                    : "text-muted-foreground"
                }`}
              >
                {latest.totalIncrease != null
                  ? `${latest.totalIncrease >= 0 ? "+" : ""}${formatAUD(
                      latest.totalIncrease,
                    ).replace("A$", "$")}`
                  : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {years.length >= 2 && (
        <Card>
          <CardContent className="p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              History
            </p>
            <SuperHistoryChart
              years={years.map((y) => ({
                fyEndYear: y.fyEndYear,
                byFund: new Map(
                  Array.from(y.byFund.entries()).map(([k, s]) => [
                    k,
                    parseFloat(s.balance),
                  ]),
                ),
                totalIncrease: y.totalIncrease,
              }))}
              fundColumns={fundColumns}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Yearly snapshots
            </p>
            {!adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add fund/year
              </Button>
            )}
          </div>
          {adding && (
            <SnapshotForm
              person={person}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                mutate(swrKey);
              }}
            />
          )}
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-6 text-center">Loading…</p>
          ) : years.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">
              No snapshots yet — use the button above to add the first one.
            </p>
          ) : editingId ? (
            // Issue #100: key on editingId so the form re-mounts when
            // the operator switches from editing snapshot A to B
            // before saving. Without the key, React reuses the form
            // instance with a new `snapshot` prop, but the internal
            // useState initialisers don't re-run — A's values stay in
            // the visible fields.
            <SnapshotForm
              key={editingId}
              person={person}
              snapshot={snapshots.find((s) => s.id === editingId)!}
              onCancel={() => setEditingId(null)}
              onSaved={() => {
                setEditingId(null);
                mutate(swrKey);
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] text-muted-foreground font-medium border-b">
                    <th className="text-left px-3 py-1.5 whitespace-nowrap">Year</th>
                    {fundColumns.map((fund) => (
                      <th
                        key={fund}
                        className="text-right px-3 py-1.5 whitespace-nowrap"
                      >
                        {fund || "Unnamed"}
                      </th>
                    ))}
                    {fundColumns.length > 1 && (
                      <th className="text-right px-3 py-1.5 whitespace-nowrap">
                        Total
                      </th>
                    )}
                    <th className="text-right px-3 py-1.5 whitespace-nowrap">
                      Total increase
                    </th>
                    <th className="text-right px-3 py-1.5 whitespace-nowrap">
                      Total gain %
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {years
                    .slice()
                    .reverse()
                    .map((y) => (
                      <YearRow
                        key={y.fyEndYear}
                        year={y}
                        fundColumns={fundColumns}
                        swrKey={swrKey}
                        onEdit={(id) => setEditingId(id)}
                      />
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EditableHeading({
  person,
  heading,
  onDelete,
}: {
  person: string;
  heading: string;
  onDelete?: (key: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(heading);
  const [saving, setSaving] = useState(false);

  // Issue #100: keep `draft` in sync with the `heading` prop when the
  // operator ISN'T mid-edit. Without this, a heading change pushed
  // from another tab / bulk import while this component is mounted
  // leaves `draft` stuck at the pre-change value; the next time the
  // operator enters edit mode the button's `setDraft(heading)` fixes
  // it, but a stale render in between flashes the wrong label.
  useEffect(() => {
    if (!editing) setDraft(heading);
  }, [heading, editing]);

  async function save() {
    if (draft === heading) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await fetch(
      `/api/super/people/${encodeURIComponent(person)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: draft }),
      },
    );
    if (res.ok) {
      // Hosting page subscribes to /api/super/people; invalidate it
      // so the heading + tab order pick up the new label.
      mutate("/api/super/people");
      setEditing(false);
    } else {
      toast.error("Couldn't save label");
    }
    setSaving(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(heading);
              setEditing(false);
            }
          }}
          maxLength={40}
          className="h-9 text-xl font-semibold w-auto max-w-xs"
        />
        <Button
          size="sm"
          onClick={save}
          disabled={saving}
          aria-label="Save heading"
          title="Save heading"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(heading);
            setEditing(false);
          }}
          aria-label="Cancel heading edit"
          title="Cancel heading edit"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 group">
      <button
        type="button"
        onClick={() => {
          setDraft(heading);
          setEditing(true);
        }}
        className="inline-flex items-center gap-2 text-xl font-semibold hover:text-foreground"
      >
        {heading}
        <Pencil className="h-3.5 w-3.5 text-muted-foreground lg:opacity-0 lg:group-hover:opacity-100 transition-opacity" />
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(person)}
          className="p-1 rounded text-muted-foreground hover:text-rose-500 hover:bg-muted transition-colors lg:opacity-0 lg:group-hover:opacity-100"
          title={`Remove "${heading}" and all their snapshots`}
          aria-label="Remove person"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function YearRow({
  year,
  fundColumns,
  swrKey,
  onEdit,
}: {
  year: YearGroup;
  fundColumns: string[];
  swrKey: string;
  onEdit: (id: string) => void;
}) {
  const confirm = useConfirm();
  async function handleDelete(snap: Snapshot) {
    const label = snap.fundName ?? "snapshot";
    const ok = await confirm({
      title: "Delete snapshot",
      description: `Delete ${label} (${formatFY(year.fyEndYear)})?`,
      confirmLabel: "Delete",
    });
    if (!ok) return;
    const res = await fetch(`/api/super/${snap.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Removed");
      mutate(swrKey);
    } else {
      toast.error("Delete failed");
    }
  }

  return (
    <tr className="group hover:bg-muted/50">
      <td className="px-3 py-2 whitespace-nowrap font-medium">
        {formatFY(year.fyEndYear)}
      </td>
      {fundColumns.map((fund) => {
        const snap = year.byFund.get(fund);
        if (!snap) {
          return (
            <td
              key={fund}
              className="px-3 py-2 text-right text-muted-foreground tabular-nums whitespace-nowrap"
            >
              —
            </td>
          );
        }
        return (
          <td
            key={fund}
            className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
          >
            <span className="inline-flex items-center gap-1">
              <span className="font-medium">{formatAUD(num(snap.balance))}</span>
              <span className="inline-flex gap-0.5 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => onEdit(snap.id)}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                  aria-label="Edit"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(snap)}
                  className="p-0.5 rounded text-muted-foreground hover:text-red-500 hover:bg-muted"
                  aria-label="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            </span>
          </td>
        );
      })}
      {fundColumns.length > 1 && (
        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap font-semibold">
          {formatAUD(year.total)}
        </td>
      )}
      <td
        className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
          year.totalIncrease != null
            ? amountClass(year.totalIncrease)
            : "text-muted-foreground"
        }`}
      >
        {year.totalIncrease != null ? formatAUD(year.totalIncrease) : "—"}
      </td>
      <td
        className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
          year.totalGainPct != null
            ? amountClass(year.totalGainPct)
            : "text-muted-foreground"
        }`}
      >
        {formatPct(year.totalGainPct)}
      </td>
    </tr>
  );
}

function SnapshotForm({
  person,
  snapshot,
  onCancel,
  onSaved,
}: {
  person: string;
  snapshot?: Snapshot;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [year, setYear] = useState(
    String(snapshot?.fyEndYear ?? new Date().getFullYear()),
  );
  const [balance, setBalance] = useState(snapshot?.balance ?? "");
  const [fundName, setFundName] = useState(snapshot?.fundName ?? "");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const yearNum = parseInt(year, 10);
    if (!yearNum || yearNum < 1990 || yearNum > 2200) {
      toast.error("Enter a valid FY-end year");
      return;
    }
    if (!balance) {
      toast.error("Enter a balance");
      return;
    }
    setLoading(true);
    const payload = {
      fyEndYear: yearNum,
      balance,
      person,
      fundName: fundName || null,
    };
    const res = snapshot
      ? await fetch(`/api/super/${snapshot.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/super", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    if (res.ok) {
      toast.success("Saved");
      onSaved();
    } else {
      toast.error("Save failed");
    }
    setLoading(false);
  }

  return (
    <form
      onSubmit={handleSubmit}
      // Disable HTML5 native validation — the JS handler at
      // handleSubmit already validates year + balance and surfaces
      // toast errors. Without this, the browser's native bad-input
      // tooltip blocks form submission silently and the JS handler
      // never runs, leaving the operator staring at a Save button
      // that "does nothing". Caught by the monkey crawl on
      // 2026-05-26 — see TEST-RESULTS.md.
      noValidate
      className="border-b bg-muted/30 p-3 space-y-2"
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div>
          <Label className="text-xs" htmlFor="super-year">
            FY end year
          </Label>
          <Input
            id="super-year"
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="super-fund">
            Fund
          </Label>
          <Input
            id="super-fund"
            value={fundName}
            onChange={(e) => setFundName(e.target.value)}
            placeholder="Mercer, Rest, etc."
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="super-balance">
            Balance
          </Label>
          <Input
            id="super-balance"
            type="number"
            step="0.01"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCancel}
        >
          <X className="h-3 w-3 mr-1" /> Cancel
        </Button>
        <Button type="submit" size="sm" disabled={loading}>
          <Check className="h-3 w-3 mr-1" />
          {loading ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
