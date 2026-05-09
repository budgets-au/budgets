"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ConfirmOptions {
  title?: string;
  /** Body text. Plain string only — no HTML so accidental injection from
   * a payee/category name can't escape into markup. */
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "destructive" = red action button (delete / wipe); "default" = neutral.
   * Defaults to destructive because every existing native-confirm() in this
   * app is a destructive action. */
  tone?: "destructive" | "default";
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface ConfirmState extends Required<Omit<ConfirmOptions, "tone">> {
  tone: "destructive" | "default";
}

/**
 * Provider that owns the confirm dialog. Mount once near the app root;
 * call sites use `useConfirm()` to get an async `confirm(opts)` and
 * resolve to a boolean. Replaces `if (!confirm(msg)) return;` patterns
 * with `if (!(await confirm({ description: msg }))) return;`.
 */
export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);
  // Latest resolver kept in a ref so escape/overlay close still resolves
  // even mid-tear-down.
  const pendingRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current = resolve;
      setState({
        title: opts.title ?? "Are you sure?",
        description: opts.description,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        cancelLabel: opts.cancelLabel ?? "Cancel",
        tone: opts.tone ?? "destructive",
      });
    });
  }, []);

  function close(ok: boolean) {
    pendingRef.current?.(ok);
    pendingRef.current = null;
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={state !== null}
        onOpenChange={(o) => !o && close(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{state?.title}</AlertDialogTitle>
            <AlertDialogDescription>{state?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>
              {state?.cancelLabel}
            </AlertDialogCancel>
            <AlertDialogAction
              variant={state?.tone === "destructive" ? "destructive" : "default"}
              onClick={() => close(true)}
            >
              {state?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    throw new Error(
      "useConfirm() must be used within <ConfirmDialogProvider>. " +
        "The provider is mounted at src/app/(app)/layout.tsx.",
    );
  }
  return fn;
}
