"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import {
  NewScheduledDialog,
  blankScheduledRow,
} from "@/components/scheduled/new-scheduled-dialog";
import type { ScheduledFormRow } from "@/components/scheduled/scheduled-edit-form";

interface AddScheduledContext {
  /** Open the dialog. Pass an `initialRow` to pre-fill (used by
   * "make this transaction recurring" flows); pass nothing for a
   * blank schedule. */
  open: (initialRow?: ScheduledFormRow) => void;
}

const Ctx = createContext<AddScheduledContext | null>(null);

/** Pop the New-Scheduled dialog from anywhere in the app shell. */
export function useAddScheduled(): AddScheduledContext {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error("useAddScheduled must be used inside <AddScheduledProvider>");
  }
  return c;
}

/** Host once at the app shell — the sidebar quick-add affordance and
 * any future entry-point reuse the same dialog instance. */
export function AddScheduledProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [row, setRow] = useState<ScheduledFormRow>(blankScheduledRow);

  const open = useCallback<AddScheduledContext["open"]>((initial) => {
    setRow(initial ?? blankScheduledRow());
    setIsOpen(true);
  }, []);

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      <NewScheduledDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        initialRow={row}
      />
    </Ctx.Provider>
  );
}
