"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { CATEGORICAL_PALETTE } from "@/lib/colours";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Everyday / Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
  { value: "loan", label: "Loan / Mortgage" },
  { value: "cash", label: "Cash" },
];

const COLORS = CATEGORICAL_PALETTE;

export default function NewAccountPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState("checking");
  const [color, setColor] = useState(COLORS[0]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        type,
        institution: form.get("institution") || undefined,
        accountNumberLast4: form.get("accountNumberLast4") || undefined,
        startingBalance: form.get("startingBalance") || "0",
        startingDate: form.get("startingDate") || undefined,
        color,
      }),
    });

    if (res.ok) {
      toast.success("Account created");
      router.push("/dashboard");
    } else {
      toast.error("Failed to create account");
      setLoading(false);
    }
  }

  return (
    <div>
      <Topbar title="New Account" />
      <div className="p-4 lg:p-6 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Add Account</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Account name *</Label>
                <Input id="name" name="name" placeholder="ANZ Everyday" required />
              </div>

              <div className="space-y-2">
                <Label>Account type *</Label>
                <Select value={type} onValueChange={(v) => setType(v ?? "checking")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACCOUNT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="institution">Bank / Institution</Label>
                <Input id="institution" name="institution" placeholder="ANZ, CommBank…" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="accountNumberLast4">Last 4 digits of account number</Label>
                <Input
                  id="accountNumberLast4"
                  name="accountNumberLast4"
                  placeholder="1234"
                  maxLength={4}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startingBalance">Opening balance (AUD)</Label>
                  <Input
                    id="startingBalance"
                    name="startingBalance"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="startingDate">As of date</Label>
                  <Input id="startingDate" name="startingDate" type="date" min="1900-01-01" max="2099-12-31" />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Colour</Label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        color === c ? "border-slate-800 scale-110" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving…" : "Create Account"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
