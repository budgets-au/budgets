"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { mutate as globalMutate } from "swr";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACCOUNT_TYPES = [
  { value: "checking", label: "Everyday / Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit Card" },
  { value: "loan", label: "Loan / Mortgage" },
  { value: "cash", label: "Cash" },
] as const;

type AccountType = (typeof ACCOUNT_TYPES)[number]["value"];

/** Shape returned by `POST /api/accounts`. Forwarded verbatim to the
 *  `onCreated` callback so callers can apply the new id immediately. */
export interface CreatedAccount {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  accountNumberLast4: string | null;
  color: string;
}

interface AddAccountContext {
  /** Open the dialog. All preset fields are optional; the CSV-import
   *  flow prefills `name` (from the bank's account-id) and
   *  `accountNumberLast4` so the operator only has to confirm. */
  open: (preset?: {
    name?: string;
    type?: AccountType;
    institution?: string;
    accountNumberLast4?: string;
    onCreated?: (acct: CreatedAccount) => void;
  }) => void;
}

const Ctx = createContext<AddAccountContext | null>(null);

export function useAddAccount(): AddAccountContext {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error("useAddAccount must be used inside <AddAccountProvider>");
  }
  return c;
}

export function AddAccountProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("checking");
  const [institution, setInstitution] = useState("");
  const [last4, setLast4] = useState("");
  const [startingBalance, setStartingBalance] = useState("0");
  const [loading, setLoading] = useState(false);
  const onCreatedRef = useRef<((acct: CreatedAccount) => void) | undefined>(
    undefined,
  );

  const open = useCallback<AddAccountContext["open"]>((preset) => {
    setName(preset?.name ?? "");
    setType(preset?.type ?? "checking");
    setInstitution(preset?.institution ?? "");
    setLast4((preset?.accountNumberLast4 ?? "").replace(/\D/g, "").slice(0, 4));
    setStartingBalance("0");
    onCreatedRef.current = preset?.onCreated;
    setIsOpen(true);
  }, []);

  function handleClose(next: boolean) {
    setIsOpen(next);
    if (!next) {
      setName("");
      setInstitution("");
      setLast4("");
      setStartingBalance("0");
      onCreatedRef.current = undefined;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        type,
        institution: institution.trim() || undefined,
        accountNumberLast4: last4 || undefined,
        startingBalance: startingBalance || "0",
      }),
    });
    setLoading(false);
    if (res.ok) {
      const created = (await res.json().catch(() => null)) as
        | CreatedAccount
        | null;
      toast.success("Account created");
      setIsOpen(false);
      setName("");
      setInstitution("");
      setLast4("");
      setStartingBalance("0");
      // Optimistically inject the new row into every subscriber's
      // cache so the picker that opened this dialog can render the
      // new account immediately. Mirrors the pattern used by the
      // Add-Category dialog. Background revalidation still runs.
      if (created) {
        await globalMutate(
          "/api/accounts",
          (current: CreatedAccount[] | undefined) => {
            if (!current) return [created];
            if (current.some((a) => a.id === created.id)) return current;
            return [...current, created];
          },
          { revalidate: true },
        );
      }
      if (created && onCreatedRef.current) {
        onCreatedRef.current(created);
      }
      onCreatedRef.current = undefined;
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error ?? "Failed to create account");
    }
  }

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New account</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3 mt-1">
            <div className="space-y-1">
              <Label htmlFor="add-acct-name">Name</Label>
              <Input
                id="add-acct-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Everyday"
                required
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) =>
                  setType((v as AccountType) ?? "checking")
                }
              >
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
            <div className="space-y-1">
              <Label htmlFor="add-acct-institution">
                Institution (optional)
              </Label>
              <Input
                id="add-acct-institution"
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="e.g. ANZ"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-acct-last4">Last 4 digits (optional)</Label>
              <Input
                id="add-acct-last4"
                value={last4}
                maxLength={4}
                onChange={(e) =>
                  setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                placeholder="e.g. 1234"
              />
              <p className="text-[11px] text-muted-foreground">
                Used to auto-resolve future CSV/QIF imports.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="add-acct-starting">Starting balance</Label>
              <Input
                id="add-acct-starting"
                type="number"
                step="0.01"
                value={startingBalance}
                onChange={(e) => setStartingBalance(e.target.value)}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="submit"
                disabled={loading || !name.trim()}
                className="flex-1"
              >
                {loading ? "Creating…" : "Create"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleClose(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}
