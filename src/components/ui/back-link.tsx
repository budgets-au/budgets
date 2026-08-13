import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** Up-navigation for a detail route.
 *
 *  Detail pages previously had no way out except the sidebar — the
 *  Topbar shows the record's own name, so there was nothing pointing
 *  back to the list it came from. This is deliberately a small muted
 *  link above the content rather than a full breadcrumb trail: the
 *  hierarchy here is only ever two levels deep (list → record), so a
 *  trail would be ceremony.
 *
 *  Note the report-internal "Back" buttons in `expenses-drilldown`
 *  and `treemap-report` are a different thing — they pop
 *  component-local drill state, not routes, and stay as they are. */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-0.5 -ml-1 text-xs text-muted-foreground hover:text-foreground transition-colors print:hidden",
        className,
      )}
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}
