"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/hooks/use-confirm-dialog";

interface PayeeRule {
  id: string;
  normalizedPayee: string;
  categoryId: string | null;
  categoryName: string | null;
  source: string;
  confidence: number;
  updatedAt: string;
}

export function PayeeRulesManager() {
  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [loading, setLoading] = useState(true);
  const confirm = useConfirm();

  async function load() {
    const res = await fetch("/api/payee-rules");
    if (res.ok) setRules(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function deleteRule(rule: PayeeRule) {
    const ok = await confirm({
      title: "Delete payee rule",
      description: `Drop the auto-categorise rule for "${rule.normalizedPayee}"${rule.categoryName ? ` → ${rule.categoryName}` : ""}? Future imports won't auto-pick this category; existing transactions keep their current category.`,
      confirmLabel: "Delete rule",
    });
    if (!ok) return;
    const res = await fetch(`/api/payee-rules/${rule.id}`, { method: "DELETE" });
    if (res.ok) {
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast.success("Rule deleted");
    } else {
      toast.error("Failed to delete rule");
    }
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div>
        <p className="font-medium text-sm">Payee Rules</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Learned automatically when you categorise transactions. Rules apply to future imports.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          No rules yet. Categorise a transaction to create one.
        </p>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Payee</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Category</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Source</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono text-xs truncate max-w-[200px]">
                    {rule.normalizedPayee}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {rule.categoryName ?? <span className="italic">Deleted</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        rule.source === "ai"
                          ? "bg-indigo-100 text-indigo-700"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {rule.source}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => deleteRule(rule)}
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                      title="Delete rule"
                      aria-label={`Delete payee rule for ${rule.normalizedPayee}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
