"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { KeyRound } from "lucide-react";

/** Strip across the top of the app shell that appears for users
 * whose stored password still matches the `admin/admin` seed.
 * Detected server-side in NextAuth's `authorize` callback via a
 * `compare("admin", user.passwordHash)` call after the login
 * compare succeeds; the result rides the JWT on `session.user
 * .mustChangePassword`.
 *
 * The strip stays visible across every route until the operator
 * changes their password AND signs back in (the JWT refresh on
 * next login re-runs the compare and the flag clears). Doesn't
 * block navigation — that would be hostile when the operator
 * has work in flight — but it links straight to the user-manager
 * so the fix is one click away.
 *
 * Tinted amber to read as "attention" without being a destructive
 * red; consistent with the warning-status tone in theme.md. */
export function MustChangePasswordBanner() {
  const { data: session } = useSession();
  const mustChange =
    (session?.user as { mustChangePassword?: boolean } | undefined)
      ?.mustChangePassword === true;
  if (!mustChange) return null;
  return (
    <div
      data-print-hide
      className="border-b border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <KeyRound className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            Default <code className="font-mono">admin/admin</code> password
            still in use. Change it before exposing this server beyond
            your LAN.
          </span>
        </div>
        <Link
          href="/settings?tab=security"
          className="shrink-0 underline hover:text-amber-900 dark:hover:text-amber-200"
        >
          Change password →
        </Link>
      </div>
    </div>
  );
}
