"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { mutate as globalMutate } from "swr";
import { useSwrJson } from "@/hooks/use-swr-json";
import { AddTransactionDialog } from "@/components/transactions/add-transaction-dialog";


interface AccountLite {
  id: string;
  name: string;
  color?: string;
}

interface CategoryLite {
  id: string;
  name: string;
  parentId: string | null;
  type?: string;
}

interface AddTransactionContext {
  /** Open the dialog. Optional `defaultAccountId` pre-selects an
   *  account (the transactions page passes its current filter so the
   *  operator isn't forced to re-pick). */
  open: (preset?: { defaultAccountId?: string | null }) => void;
}

const Ctx = createContext<AddTransactionContext | null>(null);

/** Pop the global Add-Transaction dialog from anywhere in the app shell. */
export function useAddTransaction(): AddTransactionContext {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error(
      "useAddTransaction must be used inside <AddTransactionProvider>",
    );
  }
  return c;
}

/** Host once at the app shell — the sidebar quick-add affordance and
 *  the toolbar button on /transactions share this single dialog
 *  instance so the form state never lives in two places. */
export function AddTransactionProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);

  // Lazy-load reference data — the dialog only needs it while open,
  // and most pageviews never open it.
  const { data: accounts = [] } = useSwrJson<AccountLite[]>(
    isOpen ? "/api/accounts" : null,
  );
  const { data: categories = [] } = useSwrJson<CategoryLite[]>(
    isOpen ? "/api/categories" : null,
  );

  const open = useCallback<AddTransactionContext["open"]>((preset) => {
    setDefaultAccountId(preset?.defaultAccountId ?? null);
    setIsOpen(true);
  }, []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <AddTransactionDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        accounts={accounts}
        categories={categories}
        defaultAccountId={defaultAccountId}
        onCreated={() => {
          // Refresh any open transactions list, the counts banner,
          // and downstream report caches that depend on the new row.
          globalMutate(
            (key) =>
              typeof key === "string" &&
              (key.startsWith("/api/transactions") ||
                key.startsWith("/api/cashflow") ||
                key.startsWith("/api/reports/")),
            undefined,
            { revalidate: true },
          );
        }}
      />
    </Ctx.Provider>
  );
}
