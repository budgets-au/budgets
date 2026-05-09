"use client";

import { signOut } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { User, LogOut } from "lucide-react";
import { useSession } from "next-auth/react";

export function Topbar({
  title,
  actions,
}: {
  title?: string;
  /** Page-specific buttons rendered between the title and the account dropdown. */
  actions?: React.ReactNode;
}) {
  const { data: session } = useSession();
  return (
    <header
      data-print-hide
      className="h-14 border-b bg-background flex items-center justify-between px-4 lg:px-6 sticky top-0 z-20 gap-3"
    >
      <h1 className="font-semibold text-base shrink-0">{title}</h1>
      <div className="flex items-center gap-2">
        {actions}
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg px-2.5 h-8 text-sm font-medium hover:bg-muted transition-colors">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">{session?.user?.name ?? "Account"}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
